// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract EventMarket is 
    AccessControl, 
    ReentrancyGuard,
    Pausable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");
    
    enum MarketStatus {
        ACTIVE,
        LOCKED,
        RESOLVED,
        CANCELLED
    }
    
    enum OutcomeType {
        BINARY,
        MULTIPLE_CHOICE,
        SCALAR
    }
    
    struct Market {
        bytes32 marketId;
        bytes32 eventId;
        string question;
        string[] outcomes;
        OutcomeType outcomeType;
        uint256 createdAt;
        uint256 endTime;
        uint256 resolutionTime;
        MarketStatus status;
        uint256 totalVolume;
        uint256 totalShares;
        uint256 winningOutcome;
        address creator;
        uint256 creatorFee;
        uint256 platformFee;
    }
    
    struct Position {
        uint256 outcome;
        uint256 shares;
        uint256 avgPrice;
        uint256 invested;
    }
    
    mapping(bytes32 => Market) public markets;
    mapping(bytes32 => mapping(uint256 => uint256)) public outcomeLiquidity;
    mapping(bytes32 => mapping(address => mapping(uint256 => Position))) public positions;
    mapping(bytes32 => mapping(address => bool)) public hasClaimed;
    mapping(address => bytes32[]) public userMarkets;
    
    address public oracleRegistry;
    address public treasury;
    uint256 public defaultPlatformFee;
    uint256 public minMarketDuration;
    uint256 public maxMarketDuration;
    
    event MarketCreated(
        bytes32 indexed marketId,
        bytes32 indexed eventId,
        string question,
        uint256 endTime,
        address creator
    );
    event SharesPurchased(
        bytes32 indexed marketId,
        address indexed buyer,
        uint256 outcome,
        uint256 shares,
        uint256 cost
    );
    event SharesSold(
        bytes32 indexed marketId,
        address indexed seller,
        uint256 outcome,
        uint256 shares,
        uint256 payout
    );
    event MarketResolved(bytes32 indexed marketId, uint256 winningOutcome);
    event WinningsClaimed(bytes32 indexed marketId, address indexed user, uint256 amount);
    event MarketCancelled(bytes32 indexed marketId);
    
    error InvalidMarketDuration();
    error MarketNotActive();
    error MarketNotResolved();
    error InvalidOutcome();
    error InsufficientLiquidity();
    error AlreadyClaimed();
    error NoPosition();
    error TransferFailed();
    error ZeroAmount();
    error ZeroAddress();
    error MarketExpired();
    
    constructor(
        address _oracleRegistry,
        address _treasury,
        uint256 _defaultPlatformFee,
        uint256 _minMarketDuration,
        uint256 _maxMarketDuration
    ) {
        if (_oracleRegistry == address(0) || _treasury == address(0)) revert ZeroAddress();
        
        oracleRegistry = _oracleRegistry;
        treasury = _treasury;
        defaultPlatformFee = _defaultPlatformFee;
        minMarketDuration = _minMarketDuration;
        maxMarketDuration = _maxMarketDuration;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(MARKET_CREATOR_ROLE, msg.sender);
    }
    
    function createMarket(
        bytes32 marketId,
        bytes32 eventId,
        string calldata question,
        string[] calldata outcomes,
        OutcomeType outcomeType,
        uint256 endTime,
        uint256 creatorFee
    ) external payable onlyRole(MARKET_CREATOR_ROLE) whenNotPaused returns (bytes32) {
        if (markets[marketId].createdAt != 0) revert MarketNotActive();
        if (endTime <= block.timestamp + minMarketDuration) revert InvalidMarketDuration();
        if (endTime > block.timestamp + maxMarketDuration) revert InvalidMarketDuration();
        if (outcomes.length < 2) revert InvalidOutcome();
        if (creatorFee + defaultPlatformFee > 1000) revert InvalidOutcome();
        
        markets[marketId] = Market({
            marketId: marketId,
            eventId: eventId,
            question: question,
            outcomes: outcomes,
            outcomeType: outcomeType,
            createdAt: block.timestamp,
            endTime: endTime,
            resolutionTime: 0,
            status: MarketStatus.ACTIVE,
            totalVolume: 0,
            totalShares: 0,
            winningOutcome: 0,
            creator: msg.sender,
            creatorFee: creatorFee,
            platformFee: defaultPlatformFee
        });
        
        if (msg.value > 0) {
            uint256 liquidityPerOutcome = msg.value / outcomes.length;
            for (uint256 i = 0; i < outcomes.length; i++) {
                outcomeLiquidity[marketId][i] = liquidityPerOutcome;
            }
        }
        
        userMarkets[msg.sender].push(marketId);
        
        emit MarketCreated(marketId, eventId, question, endTime, msg.sender);
        
        return marketId;
    }
    
    function buyShares(
        bytes32 marketId,
        uint256 outcome
    ) external payable nonReentrant whenNotPaused {
        Market storage market = markets[marketId];
        
        if (market.status != MarketStatus.ACTIVE) revert MarketNotActive();
        if (block.timestamp >= market.endTime) revert MarketExpired();
        if (outcome >= market.outcomes.length) revert InvalidOutcome();
        if (msg.value == 0) revert ZeroAmount();
        
        uint256 shares = _calculateShares(marketId, outcome, msg.value);
        if (shares == 0) revert ZeroAmount();
        
        Position storage position = positions[marketId][msg.sender][outcome];
        
        uint256 totalInvested = position.invested + msg.value;
        uint256 totalShares = position.shares + shares;
        
        position.shares = totalShares;
        position.outcome = outcome;
        position.avgPrice = (totalInvested * 1e18) / totalShares;
        position.invested = totalInvested;
        
        outcomeLiquidity[marketId][outcome] += msg.value;
        market.totalVolume += msg.value;
        market.totalShares += shares;
        
        if (userMarkets[msg.sender].length == 0 || userMarkets[msg.sender][userMarkets[msg.sender].length - 1] != marketId) {
            userMarkets[msg.sender].push(marketId);
        }
        
        emit SharesPurchased(marketId, msg.sender, outcome, shares, msg.value);
    }
    
    function sellShares(
        bytes32 marketId,
        uint256 outcome,
        uint256 shares
    ) external nonReentrant whenNotPaused {
        Market storage market = markets[marketId];
        
        if (market.status != MarketStatus.ACTIVE) revert MarketNotActive();
        if (block.timestamp >= market.endTime) revert MarketExpired();
        if (shares == 0) revert ZeroAmount();
        
        Position storage position = positions[marketId][msg.sender][outcome];
        
        if (position.shares < shares) revert NoPosition();
        
        uint256 payout = _calculatePayout(marketId, outcome, shares);
        if (payout > outcomeLiquidity[marketId][outcome]) revert InsufficientLiquidity();
        
        position.shares -= shares;
        position.invested = (position.invested * (position.shares)) / (position.shares + shares);
        
        if (position.shares == 0) {
            position.avgPrice = 0;
            position.invested = 0;
        }
        
        outcomeLiquidity[marketId][outcome] -= payout;
        market.totalShares -= shares;
        
        (bool success, ) = msg.sender.call{value: payout}("");
        if (!success) revert TransferFailed();
        
        emit SharesSold(marketId, msg.sender, outcome, shares, payout);
    }
    
    function resolveMarket(
        bytes32 marketId,
        uint256 winningOutcome
    ) external onlyRole(ADMIN_ROLE) nonReentrant {
        Market storage market = markets[marketId];
        
        if (market.status != MarketStatus.ACTIVE && market.status != MarketStatus.LOCKED) revert MarketNotActive();
        if (winningOutcome >= market.outcomes.length) revert InvalidOutcome();
        
        market.status = MarketStatus.RESOLVED;
        market.winningOutcome = winningOutcome;
        market.resolutionTime = block.timestamp;
        
        emit MarketResolved(marketId, winningOutcome);
    }
    
    function claimWinnings(bytes32 marketId) external nonReentrant {
        Market storage market = markets[marketId];
        
        if (market.status != MarketStatus.RESOLVED) revert MarketNotResolved();
        if (hasClaimed[marketId][msg.sender]) revert AlreadyClaimed();
        
        Position storage position = positions[marketId][msg.sender][market.winningOutcome];
        
        if (position.shares == 0) revert NoPosition();
        
        uint256 totalWinningShares = _getTotalOutcomeShares(marketId, market.winningOutcome);
        if (totalWinningShares == 0) revert NoPosition();
        
        uint256 poolSize = _getMarketPoolSize(marketId);
        uint256 payout = (poolSize * position.shares) / totalWinningShares;
        
        uint256 creatorFeeAmount = (payout * market.creatorFee) / 10000;
        uint256 platformFeeAmount = (payout * market.platformFee) / 10000;
        uint256 userPayout = payout - creatorFeeAmount - platformFeeAmount;
        
        hasClaimed[marketId][msg.sender] = true;
        position.shares = 0;
        position.invested = 0;
        position.avgPrice = 0;
        
        if (creatorFeeAmount > 0) {
            (bool creatorSuccess, ) = market.creator.call{value: creatorFeeAmount}("");
            if (!creatorSuccess) revert TransferFailed();
        }
        
        if (platformFeeAmount > 0) {
            (bool platformSuccess, ) = treasury.call{value: platformFeeAmount}("");
            if (!platformSuccess) revert TransferFailed();
        }
        
        (bool userSuccess, ) = msg.sender.call{value: userPayout}("");
        if (!userSuccess) revert TransferFailed();
        
        emit WinningsClaimed(marketId, msg.sender, userPayout);
    }
    
    function cancelMarket(bytes32 marketId) external onlyRole(ADMIN_ROLE) nonReentrant {
        Market storage market = markets[marketId];
        
        if (market.status == MarketStatus.RESOLVED) revert MarketNotActive();
        
        market.status = MarketStatus.CANCELLED;
        
        emit MarketCancelled(marketId);
    }
    
    function _calculateShares(
        bytes32 marketId,
        uint256 outcome,
        uint256 amount
    ) internal view returns (uint256) {
        uint256 liquidity = outcomeLiquidity[marketId][outcome];
        
        if (liquidity == 0) {
            return amount * 1e18 / 1e18;
        }
        
        uint256 newLiquidity = liquidity + amount;
        uint256 shares = (amount * 1e18 * 1e18) / newLiquidity;
        
        return shares;
    }
    
    function _calculatePayout(
        bytes32 marketId,
        uint256 outcome,
        uint256 shares
    ) internal view returns (uint256) {
        uint256 liquidity = outcomeLiquidity[marketId][outcome];
        
        if (liquidity == 0) return 0;
        
        uint256 payout = (shares * liquidity) / (shares + 1e18);
        
        return payout;
    }
    
    function _getTotalOutcomeShares(
        bytes32 marketId,
        uint256 outcome
    ) internal view returns (uint256) {
        return outcomeLiquidity[marketId][outcome];
    }
    
    function _getMarketPoolSize(bytes32 marketId) internal view returns (uint256) {
        Market memory market = markets[marketId];
        uint256 total = 0;
        
        for (uint256 i = 0; i < market.outcomes.length; i++) {
            total += outcomeLiquidity[marketId][i];
        }
        
        return total;
    }
    
    function getMarket(bytes32 marketId) external view returns (Market memory) {
        return markets[marketId];
    }
    
    function getPosition(
        bytes32 marketId,
        address user,
        uint256 outcome
    ) external view returns (Position memory) {
        return positions[marketId][user][outcome];
    }
    
    function getUserMarkets(address user) external view returns (bytes32[] memory) {
        return userMarkets[user];
    }
    
    function getMarketLiquidity(bytes32 marketId) external view returns (uint256[] memory) {
        Market memory market = markets[marketId];
        uint256[] memory liquidity = new uint256[](market.outcomes.length);
        
        for (uint256 i = 0; i < market.outcomes.length; i++) {
            liquidity[i] = outcomeLiquidity[marketId][i];
        }
        
        return liquidity;
    }
    
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    receive() external payable {}
}