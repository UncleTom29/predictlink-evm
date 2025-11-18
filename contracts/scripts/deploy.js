const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Helper function to deploy with retry
async function deployWithRetry(contractFactory, args, contractName, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`  Attempt ${i + 1}/${maxRetries} - Deploying ${contractName}...`);
      const contract = await contractFactory.deploy(...args);
      await contract.waitForDeployment();
      return contract;
    } catch (error) {
      console.log(`  Deployment attempt ${i + 1} failed:`, error.message);
      if (i === maxRetries - 1) throw error;
      console.log(`  Retrying in 5 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Helper function to wait for confirmations
async function waitForConfirmations(tx, confirmations = 2) {
  console.log(`  Waiting for ${confirmations} confirmations...`);
  await tx.wait(confirmations);
}

async function main() {
  console.log("Starting PredictLink deployment...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "BNB");
  
  if (balance < ethers.parseEther("0.1")) {
    console.log("\n⚠️  WARNING: Low balance. You may need more BNB for deployment.\n");
  }

  const deployedContracts = {};

  const minProposerBond = ethers.parseEther("10");
  const minDisputerBond = ethers.parseEther("5");
  const livenessPeriod = 2 * 60 * 60;
  const disputePeriod = 30 * 60;
  const treasuryAddress = deployer.address;

  console.log("\n=== Deployment Configuration ===");
  console.log("Min Proposer Bond:", ethers.formatEther(minProposerBond), "BNB");
  console.log("Min Disputer Bond:", ethers.formatEther(minDisputerBond), "BNB");
  console.log("Liveness Period:", livenessPeriod / 60 / 60, "hours");
  console.log("Dispute Period:", disputePeriod / 60, "minutes");
  console.log("Treasury Address:", treasuryAddress);

  console.log("\n=== Deploying Core Contracts ===\n");

  // 1. Deploy OracleRegistry
  console.log("1. Deploying OracleRegistry...");
  const OracleRegistry = await ethers.getContractFactory("OracleRegistry");
  const oracleRegistry = await deployWithRetry(
    OracleRegistry,
    [minProposerBond, minDisputerBond, livenessPeriod, disputePeriod, treasuryAddress],
    "OracleRegistry"
  );
  const oracleRegistryAddress = await oracleRegistry.getAddress();
  deployedContracts.OracleRegistry = oracleRegistryAddress;
  console.log("✓ OracleRegistry deployed to:", oracleRegistryAddress, "\n");

  // 2. Deploy StakingManager
  console.log("2. Deploying StakingManager...");
  const StakingManager = await ethers.getContractFactory("StakingManager");
  const stakingManager = await deployWithRetry(
    StakingManager,
    [
      ethers.parseEther("10000"),     // minStakeAmount
      30 * 24 * 60 * 60,              // lockPeriod (30 days)
      500,                             // rewardRate (5%)
      oracleRegistryAddress,           // oracleRegistry
      treasuryAddress                  // treasury
    ],
    "StakingManager"
  );
  const stakingManagerAddress = await stakingManager.getAddress();
  deployedContracts.StakingManager = stakingManagerAddress;
  console.log("✓ StakingManager deployed to:", stakingManagerAddress, "\n");

  // 3. Deploy RewardDistributor
  console.log("3. Deploying RewardDistributor...");
  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await deployWithRetry(
    RewardDistributor,
    [
      oracleRegistryAddress,           // oracleRegistry
      treasuryAddress,                 // treasury
      7 * 24 * 60 * 60                // defaultExpiryPeriod (7 days)
    ],
    "RewardDistributor"
  );
  const rewardDistributorAddress = await rewardDistributor.getAddress();
  deployedContracts.RewardDistributor = rewardDistributorAddress;
  console.log("✓ RewardDistributor deployed to:", rewardDistributorAddress, "\n");

  // 4. Deploy DisputeCoordinator
  console.log("4. Deploying DisputeCoordinator...");
  const DisputeCoordinator = await ethers.getContractFactory("DisputeCoordinator");
  const disputeCoordinator = await deployWithRetry(
    DisputeCoordinator,
    [
      oracleRegistryAddress,           // oracleRegistry
      3,                               // minArbitrators
      7 * 24 * 60 * 60,               // votingPeriod (7 days)
      66,                              // quorumPercentage (66%)
      ethers.parseEther("100")        // appealBond
    ],
    "DisputeCoordinator"
  );
  const disputeCoordinatorAddress = await disputeCoordinator.getAddress();
  deployedContracts.DisputeCoordinator = disputeCoordinatorAddress;
  console.log("✓ DisputeCoordinator deployed to:", disputeCoordinatorAddress, "\n");

  // 5. Deploy ProposalManager
  console.log("5. Deploying ProposalManager...");
  const ProposalManager = await ethers.getContractFactory("ProposalManager");
  const proposalManager = await deployWithRetry(
    ProposalManager,
    [
      oracleRegistryAddress,           // oracleRegistry
      treasuryAddress,                 // treasury
      minProposerBond,                 // minProposalBond
      minDisputerBond,                 // minChallengeBond
      livenessPeriod,                  // livenessPeriod
      8000                             // minConfidenceScore (80%)
    ],
    "ProposalManager"
  );
  const proposalManagerAddress = await proposalManager.getAddress();
  deployedContracts.ProposalManager = proposalManagerAddress;
  console.log("✓ ProposalManager deployed to:", proposalManagerAddress, "\n");

  // 6. Deploy SlashingManager
  console.log("6. Deploying SlashingManager...");
  const SlashingManager = await ethers.getContractFactory("SlashingManager");
  const slashingManager = await deployWithRetry(
    SlashingManager,
    [
      stakingManagerAddress,           // stakingManager
      treasuryAddress,                 // treasury
      3,                               // minApprovals
      24 * 60 * 60,                   // slashingDelay (1 day)
      5000,                            // maxSlashingPercentage (50%)
      ethers.parseEther("100000")     // permanentBanThreshold
    ],
    "SlashingManager"
  );
  const slashingManagerAddress = await slashingManager.getAddress();
  deployedContracts.SlashingManager = slashingManagerAddress;
  console.log("✓ SlashingManager deployed to:", slashingManagerAddress, "\n");

  console.log("=== Deploying Integration Contracts ===\n");

  // 7. Deploy OracleAdapter
  console.log("7. Deploying OracleAdapter...");
  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oracleAdapter = await deployWithRetry(
    OracleAdapter,
    [
      oracleRegistryAddress,           // oracleRegistry
      300,                             // cacheExpiry (5 minutes)
      5                                // maxFailures
    ],
    "OracleAdapter"
  );
  const oracleAdapterAddress = await oracleAdapter.getAddress();
  deployedContracts.OracleAdapter = oracleAdapterAddress;
  console.log("✓ OracleAdapter deployed to:", oracleAdapterAddress, "\n");

  // 8. Deploy EventMarket
  console.log("8. Deploying EventMarket...");
  const EventMarket = await ethers.getContractFactory("EventMarket");
  const eventMarket = await deployWithRetry(
    EventMarket,
    [
      oracleRegistryAddress,           // oracleRegistry
      treasuryAddress,                 // treasury
      100,                             // defaultPlatformFee (1%)
      1 * 60 * 60,                    // minMarketDuration (1 hour)
      365 * 24 * 60 * 60              // maxMarketDuration (365 days)
    ],
    "EventMarket"
  );
  const eventMarketAddress = await eventMarket.getAddress();
  deployedContracts.EventMarket = eventMarketAddress;
  console.log("✓ EventMarket deployed to:", eventMarketAddress, "\n");

  console.log("=== Setting up roles and permissions ===\n");

  const PROPOSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PROPOSER_ROLE"));
  const DISPUTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISPUTER_ROLE"));
  const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));
  const ARBITRATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ARBITRATOR_ROLE"));
  const SLASHER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SLASHER_ROLE"));
  const REPORTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REPORTER_ROLE"));

  console.log("Granting roles to deployer...");
  
  try {
    const tx1 = await oracleRegistry.grantRole(PROPOSER_ROLE, deployer.address);
    await waitForConfirmations(tx1);
    
    const tx2 = await oracleRegistry.grantRole(DISPUTER_ROLE, deployer.address);
    await waitForConfirmations(tx2);
    
    const tx3 = await oracleRegistry.grantRole(VALIDATOR_ROLE, deployer.address);
    await waitForConfirmations(tx3);
    
    const tx4 = await disputeCoordinator.grantRole(ARBITRATOR_ROLE, deployer.address);
    await waitForConfirmations(tx4);
    
    const tx5 = await proposalManager.grantRole(PROPOSER_ROLE, deployer.address);
    await waitForConfirmations(tx5);
    
    const tx6 = await slashingManager.grantRole(SLASHER_ROLE, deployer.address);
    await waitForConfirmations(tx6);
    
    const tx7 = await slashingManager.grantRole(REPORTER_ROLE, deployer.address);
    await waitForConfirmations(tx7);
    
    console.log("✓ All roles granted successfully\n");
  } catch (error) {
    console.log("⚠️  Some role grants may have failed:", error.message);
    console.log("You may need to grant roles manually\n");
  }

  console.log("=== Verifying deployments ===\n");

  try {
    console.log("Checking OracleRegistry...");
    const minBond = await oracleRegistry.minProposerBond();
    console.log("  Min Proposer Bond:", ethers.formatEther(minBond), "BNB");
    
    console.log("Checking StakingManager...");
    const minStake = await stakingManager.minStakeAmount();
    console.log("  Min Stake Amount:", ethers.formatEther(minStake), "BNB");
    
    console.log("Checking ProposalManager...");
    const minConfidence = await proposalManager.minConfidenceScore();
    console.log("  Min Confidence Score:", minConfidence.toString(), "/10000");
  } catch (error) {
    console.log("⚠️  Verification checks failed:", error.message);
  }

  console.log("\n=== Deployment Summary ===\n");
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Treasury:", treasuryAddress);
  console.log("\nDeployed Contracts:");
  console.log("-------------------");
  Object.entries(deployedContracts).forEach(([name, address]) => {
    console.log(`${name}: ${address}`);
  });

  // Save deployment data
  const outputDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, `${network.name}-${Date.now()}.json`);
  
  const deploymentData = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployedContracts,
    configuration: {
      minProposerBond: ethers.formatEther(minProposerBond),
      minDisputerBond: ethers.formatEther(minDisputerBond),
      livenessPeriod: livenessPeriod,
      disputePeriod: disputePeriod,
      treasury: treasuryAddress
    }
  };

  fs.writeFileSync(outputFile, JSON.stringify(deploymentData, null, 2));
  console.log(`\n✓ Deployment data saved to: ${outputFile}`);

  // Save environment variables
  const envFile = path.join(__dirname, "../.env.deployed");
  const envContent = `
ORACLE_REGISTRY_ADDRESS=${deployedContracts.OracleRegistry}
STAKING_MANAGER_ADDRESS=${deployedContracts.StakingManager}
REWARD_DISTRIBUTOR_ADDRESS=${deployedContracts.RewardDistributor}
DISPUTE_COORDINATOR_ADDRESS=${deployedContracts.DisputeCoordinator}
ORACLE_ADAPTER_ADDRESS=${deployedContracts.OracleAdapter}
EVENT_MARKET_ADDRESS=${deployedContracts.EventMarket}
PROPOSAL_MANAGER_ADDRESS=${deployedContracts.ProposalManager}
SLASHING_MANAGER_ADDRESS=${deployedContracts.SlashingManager}
TREASURY_ADDRESS=${treasuryAddress}
NETWORK=${network.name}
CHAIN_ID=${network.chainId}
`;

  fs.writeFileSync(envFile, envContent.trim());
  console.log(`✓ Environment variables saved to: ${envFile}`);

  console.log("\n=== Deployment Complete ===\n");
  console.log("Next steps:");
  console.log("1. Verify contracts on BSCScan");
  console.log("   npx hardhat verify --network bnbTestnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>");
  console.log("2. Update backend services with new addresses");
  console.log("3. Configure frontend with contract addresses");
  console.log("4. Test all contract interactions");
  console.log("5. Set up monitoring and alerts\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });