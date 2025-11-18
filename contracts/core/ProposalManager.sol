// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract ProposalManager is 
    AccessControl, 
    ReentrancyGuard,
    Pausable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant FINALIZER_ROLE = keccak256("FINALIZER_ROLE");
    
    enum ProposalStatus {
        PENDING,
        ACTIVE,
        CHALLENGED,
        FINALIZED,
        REJECTED,
        EXPIRED
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
        uint256 submittedAt;
        uint256 livenessExpiry;
        uint256 finalizedAt;
        ProposalStatus status;
        uint256 challengeCount;
        bool executed;
    }
    
    struct Challenge {
        bytes32 challengeId;
        bytes32 proposalId;
        address challenger;
        string reason;
        string counterEvidenceURI;
        uint256 bondAmount;
        uint256 timestamp;
        bool resolved;
        bool upheld;
    }
    
    struct ProposalMetrics {
        uint256 totalProposals;
        uint256 successfulProposals;
        uint256 challengedProposals;
        uint256 rejectedProposals;
        uint256 totalBondsLocked;
    }
    
    mapping(bytes32 => Proposal) public proposals;
    mapping(bytes32 => Challenge) public challenges;
    mapping(bytes32 => bytes32[]) public proposalChallenges;
    mapping(address => uint256) public proposerBonds;
    mapping(address => uint256) public proposerSuccessCount;
    mapping(address => uint256) public proposerFailureCount;
    mapping(bytes32 => bool) public eventHasActiveProposal;
    
    ProposalMetrics public metrics;
    
    address public oracleRegistry;
    address public treasury;
    uint256 public minProposalBond;
    uint256 public minChallengeBond;
    uint256 public livenessPeriod;
    uint256 public minConfidenceScore;
    uint256 public proposerRewardRate;
    uint256 public challengerRewardRate;
    
    event ProposalSubmitted(
        bytes32 indexed proposalId,
        bytes32 indexed eventId,
        address indexed proposer,
        uint256 bondAmount
    );
    event ProposalChallenged(
        bytes32 indexed proposalId,
        bytes32 indexed challengeId,
        address indexed challenger
    );
    event ProposalFinalized(
        bytes32 indexed proposalId,
        ProposalStatus status
    );
    event ProposalExecuted(bytes32 indexed proposalId);
    event ChallengeResolved(
        bytes32 indexed challengeId,
        bool upheld
    );
    event BondSlashed(address indexed account, uint256 amount);
    event RewardDistributed(address indexed recipient, uint256 amount);
    
    error ProposalNotFound();
    error ProposalAlreadyExists();
    error ProposalNotActive();
    error ProposalAlreadyFinalized();
    error InsufficientBond();
    error InvalidConfidenceScore();
    error LivenessPeriodNotExpired();
    error EventHasActiveProposal();
    error UnauthorizedAccess();
    error ChallengeNotFound();
    error ChallengeAlreadyResolved();
    error TransferFailed();
    error ZeroAddress();
    error InvalidParameters();
    
    constructor(
        address _oracleRegistry,
        address _treasury,
        uint256 _minProposalBond,
        uint256 _minChallengeBond,
        uint256 _livenessPeriod,
        uint256 _minConfidenceScore
    ) {
        if (_oracleRegistry == address(0) || _treasury == address(0)) revert ZeroAddress();
        
        oracleRegistry = _oracleRegistry;
        treasury = _treasury;
        minProposalBond = _minProposalBond;
        minChallengeBond = _minChallengeBond;
        livenessPeriod = _livenessPeriod;
        minConfidenceScore = _minConfidenceScore;
        proposerRewardRate = 6000;
        challengerRewardRate = 3000;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(FINALIZER_ROLE, msg.sender);
    }
    
    function submitProposal(
        bytes32 proposalId,
        bytes32 eventId,
        bytes32 outcomeHash,
        bytes calldata outcome,
        uint256 confidenceScore,
        string calldata evidenceURI
    ) external payable onlyRole(PROPOSER_ROLE) nonReentrant whenNotPaused returns (bytes32) {
        if (proposals[proposalId].submittedAt != 0) revert ProposalAlreadyExists();
        if (eventHasActiveProposal[eventId]) revert EventHasActiveProposal();
        if (msg.value < minProposalBond) revert InsufficientBond();
        if (confidenceScore > 10000) revert InvalidConfidenceScore();
        if (confidenceScore < minConfidenceScore) revert InvalidConfidenceScore();
        
        proposals[proposalId] = Proposal({
            proposalId: proposalId,
            eventId: eventId,
            proposer: msg.sender,
            outcomeHash: outcomeHash,
            outcome: outcome,
            confidenceScore: confidenceScore,
            evidenceURI: evidenceURI,
            bondAmount: msg.value,
            submittedAt: block.timestamp,
            livenessExpiry: block.timestamp + livenessPeriod,
            finalizedAt: 0,
            status: ProposalStatus.ACTIVE,
            challengeCount: 0,
            executed: false
        });
        
        proposerBonds[msg.sender] += msg.value;
        eventHasActiveProposal[eventId] = true;
        
        metrics.totalProposals++;
        metrics.totalBondsLocked += msg.value;
        
        emit ProposalSubmitted(proposalId, eventId, msg.sender, msg.value);
        
        return proposalId;
    }
    
    function challengeProposal(
        bytes32 proposalId,
        bytes32 challengeId,
        string calldata reason,
        string calldata counterEvidenceURI
    ) external payable nonReentrant whenNotPaused {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.submittedAt == 0) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.ACTIVE) revert ProposalNotActive();
        if (block.timestamp > proposal.livenessExpiry) revert LivenessPeriodNotExpired();
        if (msg.value < minChallengeBond) revert InsufficientBond();
        
        challenges[challengeId] = Challenge({
            challengeId: challengeId,
            proposalId: proposalId,
            challenger: msg.sender,
            reason: reason,
            counterEvidenceURI: counterEvidenceURI,
            bondAmount: msg.value,
            timestamp: block.timestamp,
            resolved: false,
            upheld: false
        });
        
        proposalChallenges[proposalId].push(challengeId);
        proposal.status = ProposalStatus.CHALLENGED;
        proposal.challengeCount++;
        
        metrics.challengedProposals++;
        metrics.totalBondsLocked += msg.value;
        
        emit ProposalChallenged(proposalId, challengeId, msg.sender);
    }
    
    function resolveChallenge(
        bytes32 challengeId,
        bool upheld
    ) external onlyRole(FINALIZER_ROLE) nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        
        if (challenge.timestamp == 0) revert ChallengeNotFound();
        if (challenge.resolved) revert ChallengeAlreadyResolved();
        
        challenge.resolved = true;
        challenge.upheld = upheld;
        
        Proposal storage proposal = proposals[challenge.proposalId];
        
        if (upheld) {
            uint256 slashedAmount = proposal.bondAmount;
            proposerBonds[proposal.proposer] -= slashedAmount;
            
            uint256 challengerReward = (slashedAmount * challengerRewardRate) / 10000;
            uint256 platformFee = slashedAmount - challengerReward;
            
            (bool successChallenger, ) = challenge.challenger.call{value: challengerReward + challenge.bondAmount}("");
            if (!successChallenger) revert TransferFailed();
            
            (bool successTreasury, ) = treasury.call{value: platformFee}("");
            if (!successTreasury) revert TransferFailed();
            
            proposal.status = ProposalStatus.REJECTED;
            eventHasActiveProposal[proposal.eventId] = false;
            
            proposerFailureCount[proposal.proposer]++;
            metrics.rejectedProposals++;
            metrics.totalBondsLocked -= (slashedAmount + challenge.bondAmount);
            
            emit BondSlashed(proposal.proposer, slashedAmount);
        } else {
            uint256 slashedAmount = challenge.bondAmount;
            
            uint256 proposerReward = (slashedAmount * proposerRewardRate) / 10000;
            uint256 platformFee = slashedAmount - proposerReward;
            
            proposerBonds[proposal.proposer] += proposerReward;
            
            (bool successTreasury, ) = treasury.call{value: platformFee}("");
            if (!successTreasury) revert TransferFailed();
            
            metrics.totalBondsLocked -= challenge.bondAmount;
            
            emit RewardDistributed(proposal.proposer, proposerReward);
        }
        
        emit ChallengeResolved(challengeId, upheld);
        
        _checkAndFinalizeProposal(challenge.proposalId);
    }
    
    function finalizeProposal(bytes32 proposalId) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.submittedAt == 0) revert ProposalNotFound();
        if (proposal.status == ProposalStatus.FINALIZED) revert ProposalAlreadyFinalized();
        if (proposal.status == ProposalStatus.REJECTED) revert ProposalAlreadyFinalized();
        
        if (proposal.status == ProposalStatus.ACTIVE) {
            if (block.timestamp <= proposal.livenessExpiry) revert LivenessPeriodNotExpired();
            
            proposal.status = ProposalStatus.FINALIZED;
            proposal.finalizedAt = block.timestamp;
            
            proposerSuccessCount[proposal.proposer]++;
            metrics.successfulProposals++;
            
            emit ProposalFinalized(proposalId, ProposalStatus.FINALIZED);
        } else if (proposal.status == ProposalStatus.CHALLENGED) {
            _checkAndFinalizeProposal(proposalId);
        }
    }
    
    function _checkAndFinalizeProposal(bytes32 proposalId) internal {
        Proposal storage proposal = proposals[proposalId];
        bytes32[] memory proposalChallengesList = proposalChallenges[proposalId];
        
        bool allResolved = true;
        bool anyUpheld = false;
        
        for (uint256 i = 0; i < proposalChallengesList.length; i++) {
            Challenge storage challenge = challenges[proposalChallengesList[i]];
            
            if (!challenge.resolved) {
                allResolved = false;
                break;
            }
            
            if (challenge.upheld) {
                anyUpheld = true;
            }
        }
        
        if (allResolved && !anyUpheld && proposal.status != ProposalStatus.REJECTED) {
            proposal.status = ProposalStatus.FINALIZED;
            proposal.finalizedAt = block.timestamp;
            
            proposerSuccessCount[proposal.proposer]++;
            metrics.successfulProposals++;
            
            emit ProposalFinalized(proposalId, ProposalStatus.FINALIZED);
        }
    }
    
    function executeProposal(bytes32 proposalId) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.submittedAt == 0) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.FINALIZED) revert ProposalNotActive();
        if (proposal.executed) revert ProposalAlreadyFinalized();
        
        proposal.executed = true;
        
        uint256 totalReward = proposal.bondAmount;
        uint256 proposerReward = (totalReward * proposerRewardRate) / 10000;
        uint256 platformFee = totalReward - proposerReward;
        
        proposerBonds[proposal.proposer] -= proposal.bondAmount;
        
        (bool successProposer, ) = proposal.proposer.call{value: proposerReward}("");
        if (!successProposer) revert TransferFailed();
        
        (bool successTreasury, ) = treasury.call{value: platformFee}("");
        if (!successTreasury) revert TransferFailed();
        
        eventHasActiveProposal[proposal.eventId] = false;
        metrics.totalBondsLocked -= proposal.bondAmount;
        
        emit ProposalExecuted(proposalId);
        emit RewardDistributed(proposal.proposer, proposerReward);
    }
    
    function expireProposal(bytes32 proposalId) external onlyRole(ADMIN_ROLE) {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.submittedAt == 0) revert ProposalNotFound();
        if (proposal.status == ProposalStatus.FINALIZED || proposal.status == ProposalStatus.REJECTED) {
            revert ProposalAlreadyFinalized();
        }
        
        proposal.status = ProposalStatus.EXPIRED;
        
        proposerBonds[proposal.proposer] -= proposal.bondAmount;
        
        (bool success, ) = proposal.proposer.call{value: proposal.bondAmount}("");
        if (!success) revert TransferFailed();
        
        eventHasActiveProposal[proposal.eventId] = false;
        metrics.totalBondsLocked -= proposal.bondAmount;
        
        emit ProposalFinalized(proposalId, ProposalStatus.EXPIRED);
    }
    
    function updateParameters(
        uint256 _minProposalBond,
        uint256 _minChallengeBond,
        uint256 _livenessPeriod,
        uint256 _minConfidenceScore
    ) external onlyRole(ADMIN_ROLE) {
        if (_minProposalBond > 0) minProposalBond = _minProposalBond;
        if (_minChallengeBond > 0) minChallengeBond = _minChallengeBond;
        if (_livenessPeriod > 0) livenessPeriod = _livenessPeriod;
        if (_minConfidenceScore > 0 && _minConfidenceScore <= 10000) {
            minConfidenceScore = _minConfidenceScore;
        }
    }
    
    function updateRewardRates(
        uint256 _proposerRewardRate,
        uint256 _challengerRewardRate
    ) external onlyRole(ADMIN_ROLE) {
        if (_proposerRewardRate + _challengerRewardRate > 10000) revert InvalidParameters();
        
        proposerRewardRate = _proposerRewardRate;
        challengerRewardRate = _challengerRewardRate;
    }
    
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }
    
    function getChallenge(bytes32 challengeId) external view returns (Challenge memory) {
        return challenges[challengeId];
    }
    
    function getProposalChallenges(bytes32 proposalId) external view returns (bytes32[] memory) {
        return proposalChallenges[proposalId];
    }
    
    function getProposerStats(address proposer) external view returns (
        uint256 successCount,
        uint256 failureCount,
        uint256 bondsLocked
    ) {
        return (
            proposerSuccessCount[proposer],
            proposerFailureCount[proposer],
            proposerBonds[proposer]
        );
    }
    
    function getMetrics() external view returns (ProposalMetrics memory) {
        return metrics;
    }
    
    function isProposalFinalized(bytes32 proposalId) external view returns (bool) {
        return proposals[proposalId].status == ProposalStatus.FINALIZED;
    }
    
    receive() external payable {}
}