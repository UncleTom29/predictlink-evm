// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

contract OracleRegistry is 
    UUPSUpgradeable, 
    AccessControlUpgradeable, 
    ReentrancyGuardUpgradeable,
    PausableUpgradeable 
{
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant DISPUTER_ROLE = keccak256("DISPUTER_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    struct Event {
        bytes32 eventId;
        string description;
        uint256 createdAt;
        uint256 resolutionTime;
        uint256 livenessExpiry;
        EventStatus status;
        bytes32 outcomeHash;
        bytes outcome;
        uint256 confidenceScore;
        address proposer;
        uint256 proposerBond;
        uint256 disputeCount;
        string evidenceURI;
        uint256 rewardPool;
        bool settled;
    }
    
    enum EventStatus {
        CREATED,
        PROPOSED,
        LIVENESS,
        DISPUTED,
        RESOLVED,
        SETTLED,
        CANCELLED
    }
    
    struct Proposal {
        bytes32 proposalId;
        bytes32 eventId;
        address proposer;
        bytes32 outcomeHash;
        bytes outcome;
        uint256 confidenceScore;
        string evidenceURI;
        uint256 bondAmount;
        uint256 timestamp;
        bool finalized;
    }
    
    struct Dispute {
        bytes32 disputeId;
        bytes32 proposalId;
        address disputer;
        string reason;
        string counterEvidenceURI;
        uint256 bondAmount;
        uint256 timestamp;
        DisputeOutcome outcome;
        bool resolved;
    }
    
    enum DisputeOutcome {
        PENDING,
        UPHELD,
        REJECTED
    }
    
    mapping(bytes32 => Event) public events;
    mapping(bytes32 => Proposal) public proposals;
    mapping(bytes32 => Dispute) public disputes;
    mapping(bytes32 => bytes32[]) public eventDisputes;
    mapping(address => uint256) public proposerStakes;
    mapping(address => uint256) public disputerStakes;
    mapping(address => uint256) public pendingRewards;
    
    uint256 public minProposerBond;
    uint256 public minDisputerBond;
    uint256 public livenessPeriod;
    uint256 public disputePeriod;
    uint256 public proposerRewardRate;
    uint256 public disputerRewardRate;
    uint256 public platformFeeRate;
    address public treasury;
    
    event EventCreated(bytes32 indexed eventId, string description, uint256 resolutionTime);
    event ProposalSubmitted(bytes32 indexed eventId, bytes32 proposalId, address proposer, bytes32 outcomeHash);
    event DisputeFiled(bytes32 indexed proposalId, bytes32 disputeId, address disputer);
    event DisputeResolved(bytes32 indexed disputeId, DisputeOutcome outcome);
    event EventResolved(bytes32 indexed eventId, bytes32 outcomeHash);
    event EventSettled(bytes32 indexed eventId, uint256 totalPayout);
    event RewardClaimed(address indexed recipient, uint256 amount);
    event BondSlashed(address indexed slashed, uint256 amount);
    event ParametersUpdated(string parameter, uint256 newValue);
    
    error InvalidEventStatus();
    error InsufficientBond();
    error UnauthorizedAccess();
    error EventNotFound();
    error ProposalNotFound();
    error DisputeNotFound();
    error AlreadySettled();
    error LivenessPeriodNotExpired();
    error DisputePeriodExpired();
    error InvalidConfidenceScore();
    error ZeroAddress();
    error TransferFailed();
    
    constructor() {
        _disableInitializers();
    }
    
    function initialize(
        uint256 _minProposerBond,
        uint256 _minDisputerBond,
        uint256 _livenessPeriod,
        uint256 _disputePeriod,
        address _treasury
    ) public initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        
        if (_treasury == address(0)) revert ZeroAddress();
        
        minProposerBond = _minProposerBond;
        minDisputerBond = _minDisputerBond;
        livenessPeriod = _livenessPeriod;
        disputePeriod = _disputePeriod;
        treasury = _treasury;
        
        proposerRewardRate = 6000;
        disputerRewardRate = 3000;
        platformFeeRate = 1000;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    function createEvent(
        bytes32 eventId,
        string calldata description,
        uint256 resolutionTime
    ) external onlyRole(ADMIN_ROLE) whenNotPaused {
        if (events[eventId].createdAt != 0) revert InvalidEventStatus();
        if (resolutionTime <= block.timestamp) revert InvalidEventStatus();
        
        events[eventId] = Event({
            eventId: eventId,
            description: description,
            createdAt: block.timestamp,
            resolutionTime: resolutionTime,
            livenessExpiry: 0,
            status: EventStatus.CREATED,
            outcomeHash: bytes32(0),
            outcome: "",
            confidenceScore: 0,
            proposer: address(0),
            proposerBond: 0,
            disputeCount: 0,
            evidenceURI: "",
            rewardPool: 0,
            settled: false
        });
        
        emit EventCreated(eventId, description, resolutionTime);
    }
    
    function proposeOutcome(
        bytes32 eventId,
        bytes32 outcomeHash,
        bytes calldata outcome,
        uint256 confidenceScore,
        string calldata evidenceURI
    ) external payable onlyRole(PROPOSER_ROLE) nonReentrant whenNotPaused returns (bytes32) {
        Event storage evt = events[eventId];
        
        if (evt.createdAt == 0) revert EventNotFound();
        if (evt.status != EventStatus.CREATED) revert InvalidEventStatus();
        if (msg.value < minProposerBond) revert InsufficientBond();
        if (confidenceScore > 10000) revert InvalidConfidenceScore();
        
        bytes32 proposalId = keccak256(abi.encodePacked(eventId, msg.sender, block.timestamp));
        
        proposals[proposalId] = Proposal({
            proposalId: proposalId,
            eventId: eventId,
            proposer: msg.sender,
            outcomeHash: outcomeHash,
            outcome: outcome,
            confidenceScore: confidenceScore,
            evidenceURI: evidenceURI,
            bondAmount: msg.value,
            timestamp: block.timestamp,
            finalized: false
        });
        
        evt.status = EventStatus.PROPOSED;
        evt.outcomeHash = outcomeHash;
        evt.outcome = outcome;
        evt.confidenceScore = confidenceScore;
        evt.proposer = msg.sender;
        evt.proposerBond = msg.value;
        evt.evidenceURI = evidenceURI;
        evt.livenessExpiry = block.timestamp + livenessPeriod;
        evt.rewardPool += msg.value;
        
        proposerStakes[msg.sender] += msg.value;
        
        evt.status = EventStatus.LIVENESS;
        
        emit ProposalSubmitted(eventId, proposalId, msg.sender, outcomeHash);
        
        return proposalId;
    }
    
    function fileDispute(
        bytes32 proposalId,
        string calldata reason,
        string calldata counterEvidenceURI
    ) external payable onlyRole(DISPUTER_ROLE) nonReentrant whenNotPaused returns (bytes32) {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.timestamp == 0) revert ProposalNotFound();
        
        Event storage evt = events[proposal.eventId];
        if (evt.status != EventStatus.LIVENESS) revert InvalidEventStatus();
        if (block.timestamp > evt.livenessExpiry) revert DisputePeriodExpired();
        if (msg.value < minDisputerBond) revert InsufficientBond();
        
        bytes32 disputeId = keccak256(abi.encodePacked(proposalId, msg.sender, block.timestamp));
        
        disputes[disputeId] = Dispute({
            disputeId: disputeId,
            proposalId: proposalId,
            disputer: msg.sender,
            reason: reason,
            counterEvidenceURI: counterEvidenceURI,
            bondAmount: msg.value,
            timestamp: block.timestamp,
            outcome: DisputeOutcome.PENDING,
            resolved: false
        });
        
        eventDisputes[proposal.eventId].push(disputeId);
        evt.status = EventStatus.DISPUTED;
        evt.disputeCount++;
        evt.rewardPool += msg.value;
        
        disputerStakes[msg.sender] += msg.value;
        
        emit DisputeFiled(proposalId, disputeId, msg.sender);
        
        return disputeId;
    }
    
    function resolveDispute(
        bytes32 disputeId,
        DisputeOutcome outcome
    ) external onlyRole(VALIDATOR_ROLE) nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.timestamp == 0) revert DisputeNotFound();
        if (dispute.resolved) revert InvalidEventStatus();
        
        dispute.outcome = outcome;
        dispute.resolved = true;
        
        Proposal storage proposal = proposals[dispute.proposalId];
        Event storage evt = events[proposal.eventId];
        
        if (outcome == DisputeOutcome.UPHELD) {
            uint256 slashedAmount = proposal.bondAmount;
            proposerStakes[proposal.proposer] -= slashedAmount;
            
            uint256 disputerReward = (slashedAmount * disputerRewardRate) / 10000;
            pendingRewards[dispute.disputer] += disputerReward + dispute.bondAmount;
            disputerStakes[dispute.disputer] -= dispute.bondAmount;
            
            uint256 platformFee = (slashedAmount * platformFeeRate) / 10000;
            pendingRewards[treasury] += platformFee;
            
            evt.status = EventStatus.CANCELLED;
            evt.settled = true;
            
            emit BondSlashed(proposal.proposer, slashedAmount);
        } else if (outcome == DisputeOutcome.REJECTED) {
            uint256 slashedAmount = dispute.bondAmount;
            disputerStakes[dispute.disputer] -= slashedAmount;
            
            uint256 proposerReward = (slashedAmount * 5000) / 10000;
            pendingRewards[proposal.proposer] += proposerReward;
            
            uint256 platformFee = (slashedAmount * platformFeeRate) / 10000;
            pendingRewards[treasury] += platformFee;
            
            emit BondSlashed(dispute.disputer, slashedAmount);
        }
        
        emit DisputeResolved(disputeId, outcome);
        
        bool allResolved = true;
        bytes32[] memory eventDisputeList = eventDisputes[proposal.eventId];
        for (uint256 i = 0; i < eventDisputeList.length; i++) {
            if (!disputes[eventDisputeList[i]].resolved) {
                allResolved = false;
                break;
            }
        }
        
        if (allResolved && evt.status == EventStatus.DISPUTED) {
            bool anyUpheld = false;
            for (uint256 i = 0; i < eventDisputeList.length; i++) {
                if (disputes[eventDisputeList[i]].outcome == DisputeOutcome.UPHELD) {
                    anyUpheld = true;
                    break;
                }
            }
            
            if (!anyUpheld) {
                evt.status = EventStatus.LIVENESS;
                evt.livenessExpiry = block.timestamp + livenessPeriod;
            }
        }
    }
    
    function finalizeEvent(bytes32 eventId) external nonReentrant {
        Event storage evt = events[eventId];
        
        if (evt.createdAt == 0) revert EventNotFound();
        if (evt.status != EventStatus.LIVENESS) revert InvalidEventStatus();
        if (block.timestamp <= evt.livenessExpiry) revert LivenessPeriodNotExpired();
        
        evt.status = EventStatus.RESOLVED;
        
        emit EventResolved(eventId, evt.outcomeHash);
    }
    
    function settleEvent(bytes32 eventId) external nonReentrant {
        Event storage evt = events[eventId];
        
        if (evt.createdAt == 0) revert EventNotFound();
        if (evt.status != EventStatus.RESOLVED) revert InvalidEventStatus();
        if (evt.settled) revert AlreadySettled();
        
        uint256 totalReward = evt.proposerBond;
        
        uint256 proposerReward = (totalReward * proposerRewardRate) / 10000;
        uint256 platformFee = (totalReward * platformFeeRate) / 10000;
        
        proposerStakes[evt.proposer] -= evt.proposerBond;
        pendingRewards[evt.proposer] += proposerReward;
        pendingRewards[treasury] += platformFee;
        
        evt.settled = true;
        evt.status = EventStatus.SETTLED;
        
        emit EventSettled(eventId, totalReward);
    }
    
    function claimRewards() external nonReentrant {
        uint256 amount = pendingRewards[msg.sender];
        if (amount == 0) revert InsufficientBond();
        
        pendingRewards[msg.sender] = 0;
        
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit RewardClaimed(msg.sender, amount);
    }
    
    function updateParameters(
        uint256 _minProposerBond,
        uint256 _minDisputerBond,
        uint256 _livenessPeriod,
        uint256 _disputePeriod
    ) external onlyRole(ADMIN_ROLE) {
        if (_minProposerBond > 0) {
            minProposerBond = _minProposerBond;
            emit ParametersUpdated("minProposerBond", _minProposerBond);
        }
        if (_minDisputerBond > 0) {
            minDisputerBond = _minDisputerBond;
            emit ParametersUpdated("minDisputerBond", _minDisputerBond);
        }
        if (_livenessPeriod > 0) {
            livenessPeriod = _livenessPeriod;
            emit ParametersUpdated("livenessPeriod", _livenessPeriod);
        }
        if (_disputePeriod > 0) {
            disputePeriod = _disputePeriod;
            emit ParametersUpdated("disputePeriod", _disputePeriod);
        }
    }
    
    function updateRewardRates(
        uint256 _proposerRewardRate,
        uint256 _disputerRewardRate,
        uint256 _platformFeeRate
    ) external onlyRole(ADMIN_ROLE) {
        if (_proposerRewardRate + _disputerRewardRate + _platformFeeRate != 10000) {
            revert InvalidConfidenceScore();
        }
        
        proposerRewardRate = _proposerRewardRate;
        disputerRewardRate = _disputerRewardRate;
        platformFeeRate = _platformFeeRate;
        
        emit ParametersUpdated("proposerRewardRate", _proposerRewardRate);
        emit ParametersUpdated("disputerRewardRate", _disputerRewardRate);
        emit ParametersUpdated("platformFeeRate", _platformFeeRate);
    }
    
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    function getEvent(bytes32 eventId) external view returns (Event memory) {
        return events[eventId];
    }
    
    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }
    
    function getDispute(bytes32 disputeId) external view returns (Dispute memory) {
        return disputes[disputeId];
    }
    
    function getEventDisputes(bytes32 eventId) external view returns (bytes32[] memory) {
        return eventDisputes[eventId];
    }
    
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {}
    
    receive() external payable {}
}