// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SlashingManager is 
    AccessControl, 
    ReentrancyGuard
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");
    
    enum SlashingReason {
        FALSE_PROPOSAL,
        FRIVOLOUS_DISPUTE,
        VALIDATOR_DOWNTIME,
        MALICIOUS_BEHAVIOR,
        COLLUSION,
        DATA_MANIPULATION,
        PROTOCOL_VIOLATION
    }
    
    enum SlashingStatus {
        PENDING,
        APPROVED,
        REJECTED,
        EXECUTED
    }
    
    struct SlashingRequest {
        bytes32 requestId;
        address target;
        uint256 amount;
        SlashingReason reason;
        string evidence;
        address reporter;
        uint256 timestamp;
        uint256 executionTime;
        SlashingStatus status;
        uint256 approvalCount;
        bool executed;
    }
    
    struct SlashingRecord {
        address target;
        uint256 amount;
        SlashingReason reason;
        uint256 timestamp;
        bytes32 requestId;
    }
    
    struct UserSlashingHistory {
        uint256 totalSlashed;
        uint256 slashingCount;
        uint256 lastSlashedAt;
        bool isPermanentlyBanned;
    }
    
    mapping(bytes32 => SlashingRequest) public slashingRequests;
    mapping(bytes32 => mapping(address => bool)) public hasApproved;
    mapping(address => UserSlashingHistory) public userHistory;
    mapping(address => SlashingRecord[]) public userSlashingRecords;
    mapping(SlashingReason => uint256) public reasonSlashingRates;
    mapping(address => bool) public isBlacklisted;
    
    bytes32[] public pendingRequests;
    uint256 public totalSlashed;
    uint256 public totalSlashingEvents;
    
    address public stakingManager;
    address public treasury;
    uint256 public minApprovals;
    uint256 public slashingDelay;
    uint256 public maxSlashingPercentage;
    uint256 public permanentBanThreshold;
    
    event SlashingRequested(
        bytes32 indexed requestId,
        address indexed target,
        uint256 amount,
        SlashingReason reason
    );
    event SlashingApproved(
        bytes32 indexed requestId,
        address indexed approver
    );
    event SlashingExecuted(
        bytes32 indexed requestId,
        address indexed target,
        uint256 amount
    );
    event SlashingRejected(bytes32 indexed requestId);
    event UserBlacklisted(address indexed user, string reason);
    event UserUnblacklisted(address indexed user);
    event SlashingRateUpdated(SlashingReason reason, uint256 rate);
    
    error InvalidTarget();
    error InvalidAmount();
    error RequestNotFound();
    error RequestAlreadyExecuted();
    error RequestNotApproved();
    error AlreadyApproved();
    error InsufficientApprovals();
    error SlashingDelayNotMet();
    error ExceedsMaxSlashing();
    error TransferFailed();
    error ZeroAddress();
    error InvalidParameters();
    
    constructor(
        address _stakingManager,
        address _treasury,
        uint256 _minApprovals,
        uint256 _slashingDelay,
        uint256 _maxSlashingPercentage,
        uint256 _permanentBanThreshold
    ) {
        if (_stakingManager == address(0) || _treasury == address(0)) revert ZeroAddress();
        
        stakingManager = _stakingManager;
        treasury = _treasury;
        minApprovals = _minApprovals;
        slashingDelay = _slashingDelay;
        maxSlashingPercentage = _maxSlashingPercentage;
        permanentBanThreshold = _permanentBanThreshold;
        
        reasonSlashingRates[SlashingReason.FALSE_PROPOSAL] = 10000;
        reasonSlashingRates[SlashingReason.FRIVOLOUS_DISPUTE] = 5000;
        reasonSlashingRates[SlashingReason.VALIDATOR_DOWNTIME] = 100;
        reasonSlashingRates[SlashingReason.MALICIOUS_BEHAVIOR] = 10000;
        reasonSlashingRates[SlashingReason.COLLUSION] = 10000;
        reasonSlashingRates[SlashingReason.DATA_MANIPULATION] = 10000;
        reasonSlashingRates[SlashingReason.PROTOCOL_VIOLATION] = 3000;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(SLASHER_ROLE, msg.sender);
    }
    
    function requestSlashing(
        bytes32 requestId,
        address target,
        uint256 baseAmount,
        SlashingReason reason,
        string calldata evidence
    ) external onlyRole(REPORTER_ROLE) returns (bytes32) {
        if (target == address(0)) revert InvalidTarget();
        if (baseAmount == 0) revert InvalidAmount();
        if (slashingRequests[requestId].timestamp != 0) revert RequestAlreadyExecuted();
        if (isBlacklisted[target]) revert InvalidTarget();
        
        uint256 slashingRate = reasonSlashingRates[reason];
        uint256 finalAmount = (baseAmount * slashingRate) / 10000;
        
        if (finalAmount > (baseAmount * maxSlashingPercentage) / 10000) {
            finalAmount = (baseAmount * maxSlashingPercentage) / 10000;
        }
        
        slashingRequests[requestId] = SlashingRequest({
            requestId: requestId,
            target: target,
            amount: finalAmount,
            reason: reason,
            evidence: evidence,
            reporter: msg.sender,
            timestamp: block.timestamp,
            executionTime: block.timestamp + slashingDelay,
            status: SlashingStatus.PENDING,
            approvalCount: 0,
            executed: false
        });
        
        pendingRequests.push(requestId);
        
        emit SlashingRequested(requestId, target, finalAmount, reason);
        
        return requestId;
    }
    
    function approveSlashing(bytes32 requestId) external onlyRole(SLASHER_ROLE) {
        SlashingRequest storage request = slashingRequests[requestId];
        
        if (request.timestamp == 0) revert RequestNotFound();
        if (request.executed) revert RequestAlreadyExecuted();
        if (hasApproved[requestId][msg.sender]) revert AlreadyApproved();
        
        hasApproved[requestId][msg.sender] = true;
        request.approvalCount++;
        
        emit SlashingApproved(requestId, msg.sender);
        
        if (request.approvalCount >= minApprovals) {
            request.status = SlashingStatus.APPROVED;
        }
    }
    
    function executeSlashing(bytes32 requestId) external nonReentrant {
        SlashingRequest storage request = slashingRequests[requestId];
        
        if (request.timestamp == 0) revert RequestNotFound();
        if (request.executed) revert RequestAlreadyExecuted();
        if (request.status != SlashingStatus.APPROVED) revert RequestNotApproved();
        if (request.approvalCount < minApprovals) revert InsufficientApprovals();
        if (block.timestamp < request.executionTime) revert SlashingDelayNotMet();
        
        request.executed = true;
        request.status = SlashingStatus.EXECUTED;
        
        UserSlashingHistory storage history = userHistory[request.target];
        history.totalSlashed += request.amount;
        history.slashingCount++;
        history.lastSlashedAt = block.timestamp;
        
        SlashingRecord memory record = SlashingRecord({
            target: request.target,
            amount: request.amount,
            reason: request.reason,
            timestamp: block.timestamp,
            requestId: requestId
        });
        
        userSlashingRecords[request.target].push(record);
        
        totalSlashed += request.amount;
        totalSlashingEvents++;
        
        (bool success,) = stakingManager.call(
            abi.encodeWithSignature(
                "slash(address,uint256,string)",
                request.target,
                (request.amount * 10000) / baseStake(request.target),
                request.evidence
            )
        );
        
        if (!success) revert TransferFailed();
        
        if (history.totalSlashed >= permanentBanThreshold) {
            history.isPermanentlyBanned = true;
            isBlacklisted[request.target] = true;
            emit UserBlacklisted(request.target, "Exceeded permanent ban threshold");
        }
        
        _removePendingRequest(requestId);
        
        emit SlashingExecuted(requestId, request.target, request.amount);
    }
    
    function rejectSlashing(bytes32 requestId) external onlyRole(ADMIN_ROLE) {
        SlashingRequest storage request = slashingRequests[requestId];
        
        if (request.timestamp == 0) revert RequestNotFound();
        if (request.executed) revert RequestAlreadyExecuted();
        
        request.status = SlashingStatus.REJECTED;
        
        _removePendingRequest(requestId);
        
        emit SlashingRejected(requestId);
    }
    
    function blacklistUser(address user, string calldata reason) external onlyRole(ADMIN_ROLE) {
        if (user == address(0)) revert InvalidTarget();
        
        isBlacklisted[user] = true;
        userHistory[user].isPermanentlyBanned = true;
        
        emit UserBlacklisted(user, reason);
    }
    
    function unblacklistUser(address user) external onlyRole(ADMIN_ROLE) {
        if (user == address(0)) revert InvalidTarget();
        
        isBlacklisted[user] = false;
        userHistory[user].isPermanentlyBanned = false;
        
        emit UserUnblacklisted(user);
    }
    
    function updateSlashingRate(
        SlashingReason reason,
        uint256 rate
    ) external onlyRole(ADMIN_ROLE) {
        if (rate > 10000) revert InvalidParameters();
        
        reasonSlashingRates[reason] = rate;
        
        emit SlashingRateUpdated(reason, rate);
    }
    
    function updateParameters(
        uint256 _minApprovals,
        uint256 _slashingDelay,
        uint256 _maxSlashingPercentage,
        uint256 _permanentBanThreshold
    ) external onlyRole(ADMIN_ROLE) {
        if (_minApprovals > 0) minApprovals = _minApprovals;
        if (_slashingDelay > 0) slashingDelay = _slashingDelay;
        if (_maxSlashingPercentage > 0 && _maxSlashingPercentage <= 10000) {
            maxSlashingPercentage = _maxSlashingPercentage;
        }
        if (_permanentBanThreshold > 0) permanentBanThreshold = _permanentBanThreshold;
    }
    
    function batchExecuteSlashing(bytes32[] calldata requestIds) external nonReentrant {
        for (uint256 i = 0; i < requestIds.length; i++) {
            SlashingRequest storage request = slashingRequests[requestIds[i]];
            
            if (request.timestamp == 0) continue;
            if (request.executed) continue;
            if (request.status != SlashingStatus.APPROVED) continue;
            if (request.approvalCount < minApprovals) continue;
            if (block.timestamp < request.executionTime) continue;
            
            request.executed = true;
            request.status = SlashingStatus.EXECUTED;
            
            UserSlashingHistory storage history = userHistory[request.target];
            history.totalSlashed += request.amount;
            history.slashingCount++;
            history.lastSlashedAt = block.timestamp;
            
            SlashingRecord memory record = SlashingRecord({
                target: request.target,
                amount: request.amount,
                reason: request.reason,
                timestamp: block.timestamp,
                requestId: requestIds[i]
            });
            
            userSlashingRecords[request.target].push(record);
            
            totalSlashed += request.amount;
            totalSlashingEvents++;
            
            (bool success, ) = stakingManager.call(
                abi.encodeWithSignature(
                    "slash(address,uint256,string)",
                    request.target,
                    (request.amount * 10000) / baseStake(request.target),
                    request.evidence
                )
            );
            
            if (success) {
                if (history.totalSlashed >= permanentBanThreshold) {
                    history.isPermanentlyBanned = true;
                    isBlacklisted[request.target] = true;
                    emit UserBlacklisted(request.target, "Exceeded permanent ban threshold");
                }
                
                emit SlashingExecuted(requestIds[i], request.target, request.amount);
            }
        }
    }
    
    function _removePendingRequest(bytes32 requestId) internal {
        for (uint256 i = 0; i < pendingRequests.length; i++) {
            if (pendingRequests[i] == requestId) {
                pendingRequests[i] = pendingRequests[pendingRequests.length - 1];
                pendingRequests.pop();
                break;
            }
        }
    }
    
    function baseStake(address user) internal view returns (uint256) {
        (bool success, bytes memory data) = stakingManager.staticcall(
            abi.encodeWithSignature("getStake(address)", user)
        );
        
        if (success && data.length > 0) {
            return abi.decode(data, (uint256));
        }
        
        return 0;
    }
    
    function getSlashingRequest(bytes32 requestId) external view returns (SlashingRequest memory) {
        return slashingRequests[requestId];
    }
    
    function getUserHistory(address user) external view returns (UserSlashingHistory memory) {
        return userHistory[user];
    }
    
    function getUserSlashingRecords(address user) external view returns (SlashingRecord[] memory) {
        return userSlashingRecords[user];
    }
    
    function getPendingRequests() external view returns (bytes32[] memory) {
        return pendingRequests;
    }
    
    function getSlashingRate(SlashingReason reason) external view returns (uint256) {
        return reasonSlashingRates[reason];
    }
    
    function isUserBlacklisted(address user) external view returns (bool) {
        return isBlacklisted[user];
    }
    
    function getTotalSlashed() external view returns (uint256) {
        return totalSlashed;
    }
    
    function getTotalSlashingEvents() external view returns (uint256) {
        return totalSlashingEvents;
    }
}