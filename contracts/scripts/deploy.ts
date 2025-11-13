import { ethers, upgrades } from "hardhat";
import { Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";

interface DeployedContracts {
  OracleRegistry: string;
  StakingManager: string;
  RewardDistributor: string;
  DisputeCoordinator: string;
  OracleAdapter: string;
  EventMarket: string;
  ProposalManager: string;
  SlashingManager: string;
}

async function main() {
  console.log("Starting PredictLink deployment...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB\n");

  const deployedContracts: Partial<DeployedContracts> = {};

  const minProposerBond = ethers.parseEther("1000");
  const minDisputerBond = ethers.parseEther("500");
  const livenessPeriod = 2 * 60 * 60;
  const disputePeriod = 30 * 60;
  const treasuryAddress = deployer.address;

  console.log("=== Deploying Core Contracts ===\n");

  console.log("1. Deploying OracleRegistry...");
  const OracleRegistry = await ethers.getContractFactory("OracleRegistry");
  const oracleRegistry = await upgrades.deployProxy(
    OracleRegistry,
    [
      minProposerBond,
      minDisputerBond,
      livenessPeriod,
      disputePeriod,
      treasuryAddress
    ],
    { initializer: "initialize", kind: "uups" }
  );
  await oracleRegistry.waitForDeployment();
  const oracleRegistryAddress = await oracleRegistry.getAddress();
  deployedContracts.OracleRegistry = oracleRegistryAddress;
  console.log("✓ OracleRegistry deployed to:", oracleRegistryAddress, "\n");

  console.log("2. Deploying StakingManager...");
  const StakingManager = await ethers.getContractFactory("StakingManager");
  const stakingManager = await upgrades.deployProxy(
    StakingManager,
    [
      ethers.parseEther("10000"),
      30 * 24 * 60 * 60,
      500,
      oracleRegistryAddress,
      treasuryAddress
    ],
    { initializer: "initialize" }
  );
  await stakingManager.waitForDeployment();
  const stakingManagerAddress = await stakingManager.getAddress();
  deployedContracts.StakingManager = stakingManagerAddress;
  console.log("✓ StakingManager deployed to:", stakingManagerAddress, "\n");

  console.log("3. Deploying RewardDistributor...");
  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await upgrades.deployProxy(
    RewardDistributor,
    [oracleRegistryAddress, treasuryAddress],
    { initializer: "initialize" }
  );
  await rewardDistributor.waitForDeployment();
  const rewardDistributorAddress = await rewardDistributor.getAddress();
  deployedContracts.RewardDistributor = rewardDistributorAddress;
  console.log("✓ RewardDistributor deployed to:", rewardDistributorAddress, "\n");

  console.log("4. Deploying DisputeCoordinator...");
  const DisputeCoordinator = await ethers.getContractFactory("DisputeCoordinator");
  const disputeCoordinator = await upgrades.deployProxy(
    DisputeCoordinator,
    [
      oracleRegistryAddress,
      3,
      7 * 24 * 60 * 60,
      66,
      ethers.parseEther("100")
    ],
    { initializer: "initialize" }
  );
  await disputeCoordinator.waitForDeployment();
  const disputeCoordinatorAddress = await disputeCoordinator.getAddress();
  deployedContracts.DisputeCoordinator = disputeCoordinatorAddress;
  console.log("✓ DisputeCoordinator deployed to:", disputeCoordinatorAddress, "\n");

  console.log("5. Deploying ProposalManager...");
  const ProposalManager = await ethers.getContractFactory("ProposalManager");
  const proposalManager = await upgrades.deployProxy(
    ProposalManager,
    [
      oracleRegistryAddress,
      treasuryAddress,
      minProposerBond,
      minDisputerBond,
      livenessPeriod,
      8000
    ],
    { initializer: "initialize" }
  );
  await proposalManager.waitForDeployment();
  const proposalManagerAddress = await proposalManager.getAddress();
  deployedContracts.ProposalManager = proposalManagerAddress;
  console.log("✓ ProposalManager deployed to:", proposalManagerAddress, "\n");

  console.log("6. Deploying SlashingManager...");
  const SlashingManager = await ethers.getContractFactory("SlashingManager");
  const slashingManager = await upgrades.deployProxy(
    SlashingManager,
    [
      stakingManagerAddress,
      treasuryAddress,
      3,
      24 * 60 * 60,
      5000,
      ethers.parseEther("100000")
    ],
    { initializer: "initialize" }
  );
  await slashingManager.waitForDeployment();
  const slashingManagerAddress = await slashingManager.getAddress();
  deployedContracts.SlashingManager = slashingManagerAddress;
  console.log("✓ SlashingManager deployed to:", slashingManagerAddress, "\n");

  console.log("=== Deploying Integration Contracts ===\n");

  console.log("7. Deploying OracleAdapter...");
  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oracleAdapter = await upgrades.deployProxy(
    OracleAdapter,
    [oracleRegistryAddress, 300, 5],
    { initializer: "initialize" }
  );
  await oracleAdapter.waitForDeployment();
  const oracleAdapterAddress = await oracleAdapter.getAddress();
  deployedContracts.OracleAdapter = oracleAdapterAddress;
  console.log("✓ OracleAdapter deployed to:", oracleAdapterAddress, "\n");

  console.log("8. Deploying EventMarket...");
  const EventMarket = await ethers.getContractFactory("EventMarket");
  const eventMarket = await upgrades.deployProxy(
    EventMarket,
    [
      oracleRegistryAddress,
      treasuryAddress,
      100,
      1 * 60 * 60,
      365 * 24 * 60 * 60
    ],
    { initializer: "initialize" }
  );
  await eventMarket.waitForDeployment();
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
  await oracleRegistry.grantRole(PROPOSER_ROLE, deployer.address);
  await oracleRegistry.grantRole(DISPUTER_ROLE, deployer.address);
  await oracleRegistry.grantRole(VALIDATOR_ROLE, deployer.address);
  
  await disputeCoordinator.grantRole(ARBITRATOR_ROLE, deployer.address);
  
  await proposalManager.grantRole(PROPOSER_ROLE, deployer.address);
  
  await slashingManager.grantRole(SLASHER_ROLE, deployer.address);
  await slashingManager.grantRole(REPORTER_ROLE, deployer.address);
  
  console.log("✓ Roles granted\n");

  console.log("=== Verifying deployments ===\n");

  console.log("Checking OracleRegistry...");
  const minBond = await oracleRegistry.minProposerBond();
  console.log("  Min Proposer Bond:", ethers.formatEther(minBond), "BNB");
  
  console.log("Checking StakingManager...");
  const minStake = await stakingManager.minStakeAmount();
  console.log("  Min Stake Amount:", ethers.formatEther(minStake), "BNB");
  
  console.log("Checking ProposalManager...");
  const minConfidence = await proposalManager.minConfidenceScore();
  console.log("  Min Confidence Score:", minConfidence.toString(), "/10000");

  console.log("\n=== Deployment Summary ===\n");
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Deployer:", deployer.address);
  console.log("Treasury:", treasuryAddress);
  console.log("\nDeployed Contracts:");
  console.log("-------------------");
  Object.entries(deployedContracts).forEach(([name, address]) => {
    console.log(`${name}: ${address}`);
  });

  const outputDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const network = (await ethers.provider.getNetwork()).name;
  const outputFile = path.join(outputDir, `${network}.json`);
  
  const deploymentData = {
    network: network,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
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
`;

  fs.writeFileSync(envFile, envContent.trim());
  console.log(`✓ Environment variables saved to: ${envFile}`);

  console.log("\n=== Deployment Complete ===\n");
  console.log("Next steps:");
  console.log("1. Verify contracts on BSCScan");
  console.log("2. Update backend services with new addresses");
  console.log("3. Configure frontend with contract addresses");
  console.log("4. Test all contract interactions");
  console.log("5. Set up monitoring and alerts\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });