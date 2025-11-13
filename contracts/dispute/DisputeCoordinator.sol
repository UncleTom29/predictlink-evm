// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract DisputeCoordinator is 
    Initializable,
    AccessControlUpgradeable, 
    ReentrancyGuardUpgradeable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");
    
    enum DisputeStatus {
        PENDING,
        VOTING,
        RESOLVED,
        APPEALED,
        CANCELLED
    }
    
    enum VoteChoice {
        NONE,
        UPHELD,
        REJECTED
    }
    
    struct DisputeCase {
        bytes32 disputeId;
        bytes32 proposalId;
        address disputer;
        address proposer;
        string reason;
        string evidenceURI;
        string counterEvidenceURI;
        uint256 bondAmount;
        uint256 createdAt;
        uint256 votingDeadline;
        DisputeStatus status;
        uint256 upvotes;
        uint256 downvotes;
        bool resolved;
        VoteChoice outcome;
    }
    
    struct Vote {
        address arbitrator;
        VoteChoice choice;
        uint256 timestamp;
        string justification;
    }
    
    mapping(bytes32 => DisputeCase) public disputes;
    mapping(bytes32 => mapping(address => Vote)) public votes;
    mapping(bytes32 => address[]) public disputeArbitrators;
    mapping(address => uint256) public arbitratorReputation;
    mapping(address => uint256) public totalVotes;
    
    address public oracleRegistry;
    uint256 public minArbitrators;
    uint256 public votingPeriod;
    uint256 public quorumPercentage;
    uint256 public appealBond;
    
    event DisputeCreated(bytes32 indexed disputeId, bytes32 indexed proposalId, address disputer);
    event VoteCast(bytes32 indexed disputeId, address indexed arbitrator, VoteChoice choice);
    event DisputeResolved(bytes32 indexed disputeId, VoteChoice outcome, uint256 upvotes, uint256 downvotes);
    event DisputeAppealed(bytes32 indexed disputeId, address appellant);
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);
    
    error DisputeNotFound();
    error DisputeAlreadyResolved();
    error VotingPeriodExpired();
    error VotingPeriodNotExpired();
    error AlreadyVoted();
    error NotArbitrator();
    error InsufficientQuorum();
    error InvalidVoteChoice();
    error ZeroAddress();
    error TransferFailed();
    
    constructor() {
        _disableInitializers();
    }
    
    function initialize(
        address _oracleRegistry,
        uint256 _minArbitrators,
        uint256 _votingPeriod,
        uint256 _quorumPercentage,
        uint256 _appealBond
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        
        if (_oracleRegistry == address(0)) revert ZeroAddress();
        
        oracleRegistry = _oracleRegistry;
        minArbitrators = _minArbitrators;
        votingPeriod = _votingPeriod;
        quorumPercentage = _quorumPercentage;
        appealBond = _appealBond;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    function createDispute(
        bytes32 disputeId,
        bytes32 proposalId,
        address disputer,
        address proposer,
        string calldata reason,
        string calldata evidenceURI,
        string calldata counterEvidenceURI,
        uint256 bondAmount
    ) external onlyRole(ADMIN_ROLE) {
        if (disputes[disputeId].createdAt != 0) revert DisputeAlreadyResolved();
        
        disputes[disputeId] = DisputeCase({
            disputeId: disputeId,
            proposalId: proposalId,
            disputer: disputer,
            proposer: proposer,
            reason: reason,
            evidenceURI: evidenceURI,
            counterEvidenceURI: counterEvidenceURI,
            bondAmount: bondAmount,
            createdAt: block.timestamp,
            votingDeadline: block.timestamp + votingPeriod,
            status: DisputeStatus.VOTING,
            upvotes: 0,
            downvotes: 0,
            resolved: false,
            outcome: VoteChoice.NONE
        });
        
        emit DisputeCreated(disputeId, proposalId, disputer);
    }
    
    function castVote(
        bytes32 disputeId,
        VoteChoice choice,
        string calldata justification
    ) external onlyRole(ARBITRATOR_ROLE) nonReentrant {
        DisputeCase storage dispute = disputes[disputeId];
        
        if (dispute.createdAt == 0) revert DisputeNotFound();
        if (dispute.resolved) revert DisputeAlreadyResolved();
        if (block.timestamp > dispute.votingDeadline) revert VotingPeriodExpired();
        if (votes[disputeId][msg.sender].timestamp != 0) revert AlreadyVoted();
        if (choice == VoteChoice.NONE) revert InvalidVoteChoice();
        
        votes[disputeId][msg.sender] = Vote({
            arbitrator: msg.sender,
            choice: choice,
            timestamp: block.timestamp,
            justification: justification
        });
        
        disputeArbitrators[disputeId].push(msg.sender);
        
        if (choice == VoteChoice.UPHELD) {
            dispute.upvotes++;
        } else if (choice == VoteChoice.REJECTED) {
            dispute.downvotes++;
        }
        
        totalVotes[msg.sender]++;
        
        emit VoteCast(disputeId, msg.sender, choice);
    }
    
    function resolveDispute(bytes32 disputeId) external nonReentrant {
        DisputeCase storage dispute = disputes[disputeId];
        
        if (dispute.createdAt == 0) revert DisputeNotFound();
        if (dispute.resolved) revert DisputeAlreadyResolved();
        if (block.timestamp <= dispute.votingDeadline) revert VotingPeriodNotExpired();
        
        uint256 totalVotesCount = dispute.upvotes + dispute.downvotes;
        uint256 requiredQuorum = (minArbitrators * quorumPercentage) / 100;
        
        if (totalVotesCount < requiredQuorum) revert InsufficientQuorum();
        
        if (dispute.upvotes > dispute.downvotes) {
            dispute.outcome = VoteChoice.UPHELD;
        } else {
            dispute.outcome = VoteChoice.REJECTED;
        }
        
        dispute.status = DisputeStatus.RESOLVED;
        dispute.resolved = true;
        
        _updateArbitratorReputations(disputeId, dispute.outcome);
        
        emit DisputeResolved(disputeId, dispute.outcome, dispute.upvotes, dispute.downvotes);
    }
    
    function appealDispute(bytes32 disputeId) external payable nonReentrant {
        DisputeCase storage dispute = disputes[disputeId];
        
        if (dispute.createdAt == 0) revert DisputeNotFound();
        if (!dispute.resolved) revert DisputeNotFound();
        if (msg.value < appealBond) revert TransferFailed();
        if (msg.sender != dispute.disputer && msg.sender != dispute.proposer) revert NotArbitrator();
        
        dispute.status = DisputeStatus.APPEALED;
        dispute.votingDeadline = block.timestamp + votingPeriod;
        dispute.resolved = false;
        dispute.upvotes = 0;
        dispute.downvotes = 0;
        dispute.outcome = VoteChoice.NONE;
        
        emit DisputeAppealed(disputeId, msg.sender);
    }
    
    function _updateArbitratorReputations(bytes32 disputeId, VoteChoice winningOutcome) internal {
        address[] memory arbitrators = disputeArbitrators[disputeId];
        
        for (uint256 i = 0; i < arbitrators.length; i++) {
            address arbitrator = arbitrators[i];
            Vote memory vote = votes[disputeId][arbitrator];
            
            if (vote.choice == winningOutcome) {
                arbitratorReputation[arbitrator] += 10;
            } else {
                if (arbitratorReputation[arbitrator] >= 5) {
                    arbitratorReputation[arbitrator] -= 5;
                }
            }
        }
    }
    
    function addArbitrator(address arbitrator) external onlyRole(ADMIN_ROLE) {
        if (arbitrator == address(0)) revert ZeroAddress();
        
        grantRole(ARBITRATOR_ROLE, arbitrator);
        arbitratorReputation[arbitrator] = 100;
        
        emit ArbitratorAdded(arbitrator);
    }
    
    function removeArbitrator(address arbitrator) external onlyRole(ADMIN_ROLE) {
        revokeRole(ARBITRATOR_ROLE, arbitrator);
        emit ArbitratorRemoved(arbitrator);
    }
    
    function updateParameters(
        uint256 _minArbitrators,
        uint256 _votingPeriod,
        uint256 _quorumPercentage,
        uint256 _appealBond
    ) external onlyRole(ADMIN_ROLE) {
        if (_minArbitrators > 0) minArbitrators = _minArbitrators;
        if (_votingPeriod > 0) votingPeriod = _votingPeriod;
        if (_quorumPercentage > 0 && _quorumPercentage <= 100) quorumPercentage = _quorumPercentage;
        if (_appealBond > 0) appealBond = _appealBond;
    }
    
    function getDispute(bytes32 disputeId) external view returns (DisputeCase memory) {
        return disputes[disputeId];
    }
    
    function getVote(bytes32 disputeId, address arbitrator) external view returns (Vote memory) {
        return votes[disputeId][arbitrator];
    }
    
    function getDisputeArbitrators(bytes32 disputeId) external view returns (address[] memory) {
        return disputeArbitrators[disputeId];
    }
    
    function getArbitratorReputation(address arbitrator) external view returns (uint256) {
        return arbitratorReputation[arbitrator];
    }
    
    function getArbitratorVoteCount(address arbitrator) external view returns (uint256) {
        return totalVotes[arbitrator];
    }
    
    function hasVoted(bytes32 disputeId, address arbitrator) external view returns (bool) {
        return votes[disputeId][arbitrator].timestamp != 0;
    }
    
    receive() external payable {}
}