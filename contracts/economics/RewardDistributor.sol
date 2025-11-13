// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

contract RewardDistributor is 
    Initializable,
    AccessControlUpgradeable, 
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    
    struct RewardPool {
        uint256 totalRewards;
        uint256 distributedRewards;
        uint256 participantCount;
        uint256 createdAt;
        uint256 expiryTime;
        bool active;
        uint256 totalShares;
    }
    
    struct Participant {
        uint256 shares;
        bool claimed;
        uint256 claimedAmount;
        uint256 claimedAt;
    }
    
    mapping(bytes32 => RewardPool) public rewardPools;
    mapping(bytes32 => mapping(address => Participant)) public poolParticipants;
    mapping(address => uint256) public lifetimeRewards;
    mapping(address => uint256) public pendingRewards;
    
    address public oracleRegistry;
    address public treasury;
    uint256 public defaultExpiryPeriod;
    
    event RewardPoolCreated(bytes32 indexed poolId, uint256 totalRewards, uint256 expiryTime);
    event SharesAllocated(bytes32 indexed poolId, address indexed recipient, uint256 shares);
    event RewardClaimed(bytes32 indexed poolId, address indexed recipient, uint256 amount);
    event PoolExpired(bytes32 indexed poolId, uint256 unclaimedAmount);
    event EmergencyWithdrawal(address indexed recipient, uint256 amount);
    
    error PoolNotFound();
    error PoolNotActive();
    error AlreadyClaimed();
    error NoShares();
    error TransferFailed();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidShares();
    error PoolExpired();
    error ArrayLengthMismatch();
    
    constructor() {
        _disableInitializers();
    }
    
    function initialize(
        address _oracleRegistry, 
        address _treasury,
        uint256 _defaultExpiryPeriod
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        
        if (_oracleRegistry == address(0) || _treasury == address(0)) revert ZeroAddress();
        
        oracleRegistry = _oracleRegistry;
        treasury = _treasury;
        defaultExpiryPeriod = _defaultExpiryPeriod;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(DISTRIBUTOR_ROLE, msg.sender);
    }
    
    function createRewardPool(
        bytes32 poolId,
        uint256 expiryTime
    ) external payable onlyRole(DISTRIBUTOR_ROLE) whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();
        if (rewardPools[poolId].createdAt != 0) revert PoolNotActive();
        
        if (expiryTime == 0) {
            expiryTime = block.timestamp + defaultExpiryPeriod;
        }
        
        rewardPools[poolId] = RewardPool({
            totalRewards: msg.value,
            distributedRewards: 0,
            participantCount: 0,
            createdAt: block.timestamp,
            expiryTime: expiryTime,
            active: true,
            totalShares: 0
        });
        
        emit RewardPoolCreated(poolId, msg.value, expiryTime);
    }
    
    function allocateShares(
        bytes32 poolId,
        address[] calldata recipients,
        uint256[] calldata shares
    ) external onlyRole(DISTRIBUTOR_ROLE) {
        if (recipients.length != shares.length) revert ArrayLengthMismatch();
        if (recipients.length == 0) revert ZeroAmount();
        
        RewardPool storage pool = rewardPools[poolId];
        if (!pool.active) revert PoolNotActive();
        
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (shares[i] == 0) revert InvalidShares();
            
            Participant storage participant = poolParticipants[poolId][recipients[i]];
            
            if (participant.shares == 0) {
                pool.participantCount++;
            }
            
            pool.totalShares += shares[i];
            participant.shares += shares[i];
            
            emit SharesAllocated(poolId, recipients[i], shares[i]);
        }
    }
    
    function claimReward(bytes32 poolId) external nonReentrant whenNotPaused {
        RewardPool storage pool = rewardPools[poolId];
        
        if (pool.createdAt == 0) revert PoolNotFound();
        if (!pool.active) revert PoolNotActive();
        if (block.timestamp > pool.expiryTime) revert PoolExpired();
        
        Participant storage participant = poolParticipants[poolId][msg.sender];
        
        if (participant.claimed) revert AlreadyClaimed();
        if (participant.shares == 0) revert NoShares();
        if (pool.totalShares == 0) revert InvalidShares();
        
        uint256 reward = (pool.totalRewards * participant.shares) / pool.totalShares;
        
        participant.claimed = true;
        participant.claimedAmount = reward;
        participant.claimedAt = block.timestamp;
        
        pool.distributedRewards += reward;
        lifetimeRewards[msg.sender] += reward;
        
        (bool success, ) = msg.sender.call{value: reward}("");
        if (!success) revert TransferFailed();
        
        emit RewardClaimed(poolId, msg.sender, reward);
    }
    
    function batchClaimRewards(bytes32[] calldata poolIds) external nonReentrant whenNotPaused {
        uint256 totalReward = 0;
        
        for (uint256 i = 0; i < poolIds.length; i++) {
            bytes32 poolId = poolIds[i];
            RewardPool storage pool = rewardPools[poolId];
            
            if (pool.createdAt == 0 || !pool.active || block.timestamp > pool.expiryTime) {
                continue;
            }
            
            Participant storage participant = poolParticipants[poolId][msg.sender];
            
            if (participant.claimed || participant.shares == 0 || pool.totalShares == 0) {
                continue;
            }
            
            uint256 reward = (pool.totalRewards * participant.shares) / pool.totalShares;
            
            participant.claimed = true;
            participant.claimedAmount = reward;
            participant.claimedAt = block.timestamp;
            
            pool.distributedRewards += reward;
            totalReward += reward;
            
            emit RewardClaimed(poolId, msg.sender, reward);
        }
        
        if (totalReward > 0) {
            lifetimeRewards[msg.sender] += totalReward;
            
            (bool success, ) = msg.sender.call{value: totalReward}("");
            if (!success) revert TransferFailed();
        }
    }
    
    function expirePool(bytes32 poolId) external onlyRole(ADMIN_ROLE) {
        RewardPool storage pool = rewardPools[poolId];
        
        if (pool.createdAt == 0) revert PoolNotFound();
        if (!pool.active) revert PoolNotActive();
        if (block.timestamp <= pool.expiryTime) revert PoolNotActive();
        
        pool.active = false;
        
        uint256 unclaimedAmount = pool.totalRewards - pool.distributedRewards;
        
        if (unclaimedAmount > 0) {
            (bool success, ) = treasury.call{value: unclaimedAmount}("");
            if (!success) revert TransferFailed();
        }
        
        emit PoolExpired(poolId, unclaimedAmount);
    }
    
    function updateDefaultExpiryPeriod(uint256 _defaultExpiryPeriod) external onlyRole(ADMIN_ROLE) {
        defaultExpiryPeriod = _defaultExpiryPeriod;
    }
    
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    function emergencyWithdraw(uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (amount > address(this).balance) amount = address(this).balance;
        
        (bool success, ) = treasury.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit EmergencyWithdrawal(treasury, amount);
    }
    
    function getPoolInfo(bytes32 poolId) external view returns (
        uint256 totalRewards,
        uint256 distributedRewards,
        uint256 participantCount,
        uint256 createdAt,
        uint256 expiryTime,
        bool active,
        uint256 totalShares
    ) {
        RewardPool memory pool = rewardPools[poolId];
        return (
            pool.totalRewards,
            pool.distributedRewards,
            pool.participantCount,
            pool.createdAt,
            pool.expiryTime,
            pool.active,
            pool.totalShares
        );
    }
    
    function getParticipantInfo(bytes32 poolId, address user) external view returns (
        uint256 shares,
        bool claimed,
        uint256 claimedAmount,
        uint256 claimedAt
    ) {
        Participant memory participant = poolParticipants[poolId][user];
        return (
            participant.shares,
            participant.claimed,
            participant.claimedAmount,
            participant.claimedAt
        );
    }
    
    function calculatePendingReward(bytes32 poolId, address user) external view returns (uint256) {
        RewardPool memory pool = rewardPools[poolId];
        Participant memory participant = poolParticipants[poolId][user];
        
        if (!pool.active || participant.claimed || participant.shares == 0 || pool.totalShares == 0) {
            return 0;
        }
        
        return (pool.totalRewards * participant.shares) / pool.totalShares;
    }
    
    function getUserLifetimeRewards(address user) external view returns (uint256) {
        return lifetimeRewards[user];
    }
    
    receive() external payable {}
}