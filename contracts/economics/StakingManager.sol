// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract StakingManager is 
    AccessControl, 
    ReentrancyGuard, 
    Pausable 
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    
    struct Stake {
        uint256 amount;
        uint256 stakedAt;
        uint256 lastRewardClaim;
        uint256 lockPeriod;
        bool active;
    }
    
    mapping(address => Stake) public stakes;
    mapping(address => uint256) public pendingRewards;
    mapping(address => bool) public blacklisted;
    
    uint256 public totalStaked;
    uint256 public rewardRate;
    uint256 public minStakeAmount;
    uint256 public lockPeriod;
    uint256 public slashingRate;
    uint256 public maxStakePerUser;
    
    address public oracleRegistry;
    address public treasury;
    
    event Staked(address indexed staker, uint256 amount, uint256 timestamp);
    event Unstaked(address indexed staker, uint256 amount, uint256 timestamp);
    event RewardClaimed(address indexed staker, uint256 amount, uint256 timestamp);
    event Slashed(address indexed staker, uint256 amount, string reason, uint256 timestamp);
    event Blacklisted(address indexed staker, bool status);
    event ParametersUpdated(string parameter, uint256 newValue);
    
    error InsufficientStake();
    error StakeLocked();
    error NoActiveStake();
    error TransferFailed();
    error ZeroAmount();
    error ZeroAddress();
    error BlacklistedAddress();
    error MaxStakeExceeded();
    error InvalidParameters();
    
    constructor(
        uint256 _minStakeAmount,
        uint256 _lockPeriod,
        uint256 _rewardRate,
        address _oracleRegistry,
        address _treasury
    ) {
        if (_oracleRegistry == address(0) || _treasury == address(0)) revert ZeroAddress();
        
        minStakeAmount = _minStakeAmount;
        lockPeriod = _lockPeriod;
        rewardRate = _rewardRate;
        oracleRegistry = _oracleRegistry;
        treasury = _treasury;
        slashingRate = 1000;
        maxStakePerUser = 1000000 ether;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(SLASHER_ROLE, msg.sender);
    }
    
    function stake() external payable nonReentrant whenNotPaused {
        if (blacklisted[msg.sender]) revert BlacklistedAddress();
        if (msg.value < minStakeAmount) revert InsufficientStake();
        if (msg.value == 0) revert ZeroAmount();
        
        Stake storage userStake = stakes[msg.sender];
        
        if (userStake.active) {
            _claimRewards(msg.sender);
            
            if (userStake.amount + msg.value > maxStakePerUser) revert MaxStakeExceeded();
            
            userStake.amount += msg.value;
        } else {
            if (msg.value > maxStakePerUser) revert MaxStakeExceeded();
            
            stakes[msg.sender] = Stake({
                amount: msg.value,
                stakedAt: block.timestamp,
                lastRewardClaim: block.timestamp,
                lockPeriod: lockPeriod,
                active: true
            });
        }
        
        totalStaked += msg.value;
        
        emit Staked(msg.sender, msg.value, block.timestamp);
    }
    
    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        
        Stake storage userStake = stakes[msg.sender];
        
        if (!userStake.active) revert NoActiveStake();
        if (userStake.amount < amount) revert InsufficientStake();
        if (block.timestamp < userStake.stakedAt + userStake.lockPeriod) revert StakeLocked();
        
        _claimRewards(msg.sender);
        
        userStake.amount -= amount;
        totalStaked -= amount;
        
        if (userStake.amount == 0) {
            userStake.active = false;
        }
        
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit Unstaked(msg.sender, amount, block.timestamp);
    }
    
    function claimRewards() external nonReentrant {
        _claimRewards(msg.sender);
    }
    
    function _claimRewards(address staker) internal {
        Stake storage userStake = stakes[staker];
        if (!userStake.active) return;
        
        uint256 timeStaked = block.timestamp - userStake.lastRewardClaim;
        uint256 reward = (userStake.amount * rewardRate * timeStaked) / (365 days * 10000);
        
        if (reward > 0) {
            pendingRewards[staker] += reward;
            userStake.lastRewardClaim = block.timestamp;
        }
        
        uint256 totalReward = pendingRewards[staker];
        if (totalReward > 0) {
            pendingRewards[staker] = 0;
            
            if (address(this).balance >= totalReward) {
                (bool success, ) = staker.call{value: totalReward}("");
                if (!success) revert TransferFailed();
                
                emit RewardClaimed(staker, totalReward, block.timestamp);
            }
        }
    }
    
    function slash(
        address staker, 
        uint256 percentage, 
        string calldata reason
    ) external onlyRole(SLASHER_ROLE) nonReentrant {
        Stake storage userStake = stakes[staker];
        if (!userStake.active) revert NoActiveStake();
        if (percentage > 10000) percentage = 10000;
        
        uint256 slashAmount = (userStake.amount * percentage) / 10000;
        userStake.amount -= slashAmount;
        totalStaked -= slashAmount;
        
        if (userStake.amount == 0) {
            userStake.active = false;
        }
        
        (bool success, ) = treasury.call{value: slashAmount}("");
        if (!success) revert TransferFailed();
        
        emit Slashed(staker, slashAmount, reason, block.timestamp);
    }
    
    function blacklist(address staker, bool status) external onlyRole(ADMIN_ROLE) {
        blacklisted[staker] = status;
        emit Blacklisted(staker, status);
    }
    
    function updateParameters(
        uint256 _minStakeAmount,
        uint256 _lockPeriod,
        uint256 _rewardRate,
        uint256 _maxStakePerUser
    ) external onlyRole(ADMIN_ROLE) {
        if (_minStakeAmount > 0) {
            minStakeAmount = _minStakeAmount;
            emit ParametersUpdated("minStakeAmount", _minStakeAmount);
        }
        if (_lockPeriod > 0) {
            lockPeriod = _lockPeriod;
            emit ParametersUpdated("lockPeriod", _lockPeriod);
        }
        if (_rewardRate > 0) {
            rewardRate = _rewardRate;
            emit ParametersUpdated("rewardRate", _rewardRate);
        }
        if (_maxStakePerUser > 0) {
            maxStakePerUser = _maxStakePerUser;
            emit ParametersUpdated("maxStakePerUser", _maxStakePerUser);
        }
    }
    
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    function emergencyWithdraw() external onlyRole(ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        (bool success, ) = treasury.call{value: balance}("");
        if (!success) revert TransferFailed();
    }
    
    function getStake(address staker) external view returns (Stake memory) {
        return stakes[staker];
    }
    
    function calculatePendingRewards(address staker) public view returns (uint256) {
        Stake memory userStake = stakes[staker];
        if (!userStake.active) return 0;
        
        uint256 timeStaked = block.timestamp - userStake.lastRewardClaim;
        uint256 reward = (userStake.amount * rewardRate * timeStaked) / (365 days * 10000);
        
        return reward + pendingRewards[staker];
    }
    
    function getTotalStaked() external view returns (uint256) {
        return totalStaked;
    }
    
    function isStaker(address account) external view returns (bool) {
        return stakes[account].active;
    }
    
    receive() external payable {}
}