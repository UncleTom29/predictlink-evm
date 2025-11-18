const { ethers, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Helper function to verify contract with retry
async function verifyContract(address, constructorArgs, contractName, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`\n  Verifying ${contractName} at ${address}...`);
      console.log(`  Constructor args:`, constructorArgs);
      
      await run("verify:verify", {
        address: address,
        constructorArguments: constructorArgs,
      });
      
      console.log(`  ✓ ${contractName} verified successfully!`);
      return true;
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log(`  ℹ ${contractName} is already verified`);
        return true;
      }
      
      if (error.message.includes("does not have bytecode")) {
        console.log(`  ✗ ${contractName} - Contract not found at address (may not be deployed yet)`);
        return false;
      }
      
      console.log(`  Attempt ${i + 1}/${maxRetries} failed:`, error.message);
      
      if (i === maxRetries - 1) {
        console.log(`  ✗ ${contractName} verification failed after ${maxRetries} attempts`);
        return false;
      }
      
      console.log(`  Retrying in 10 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  return false;
}

// Helper function to load deployment data
function loadDeploymentData() {
  const deploymentsDir = path.join(__dirname, "../deployments");
  
  if (!fs.existsSync(deploymentsDir)) {
    throw new Error("Deployments directory not found. Please deploy contracts first.");
  }
  
  const files = fs.readdirSync(deploymentsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(deploymentsDir, f),
      mtime: fs.statSync(path.join(deploymentsDir, f)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  if (files.length === 0) {
    throw new Error("No deployment files found. Please deploy contracts first.");
  }
  
  const latestFile = files[0];
  console.log(`Loading deployment data from: ${latestFile.name}`);
  
  const data = JSON.parse(fs.readFileSync(latestFile.path, 'utf8'));
  return data;
}

async function main() {
  console.log("=== Starting Contract Verification ===\n");
  
  // Load deployment data
  let deploymentData;
  try {
    deploymentData = loadDeploymentData();
  } catch (error) {
    console.error("Error loading deployment data:", error.message);
    console.log("\nPlease ensure you have deployed the contracts first using:");
    console.log("  npx hardhat run scripts/deploy-predict.js --network bnbTestnet");
    process.exit(1);
  }
  
  const { contracts, configuration } = deploymentData;
  
  console.log("Network:", deploymentData.network);
  console.log("Chain ID:", deploymentData.chainId);
  console.log("Deployer:", deploymentData.deployer);
  console.log("Deployment Time:", deploymentData.timestamp);
  console.log("\nContracts to verify:", Object.keys(contracts).length);
  
  // Wait a bit for contracts to propagate on BSCScan
  console.log("\nWaiting 30 seconds for contracts to propagate on BSCScan...");
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  const results = {
    verified: [],
    failed: [],
    alreadyVerified: []
  };
  
  // Parse configuration values back to proper format
  const minProposerBond = ethers.parseEther(configuration.minProposerBond);
  const minDisputerBond = ethers.parseEther(configuration.minDisputerBond);
  const livenessPeriod = configuration.livenessPeriod;
  const disputePeriod = configuration.disputePeriod;
  const treasuryAddress = configuration.treasury;
  
  console.log("\n=== Verifying Core Contracts ===");
  
  // 1. Verify OracleRegistry
  if (contracts.OracleRegistry) {
    const success = await verifyContract(
      contracts.OracleRegistry,
      [
        minProposerBond,
        minDisputerBond,
        livenessPeriod,
        disputePeriod,
        treasuryAddress
      ],
      "OracleRegistry"
    );
    if (success) results.verified.push("OracleRegistry");
    else results.failed.push("OracleRegistry");
  }
  
  // 2. Verify StakingManager
  if (contracts.StakingManager) {
    const success = await verifyContract(
      contracts.StakingManager,
      [
        ethers.parseEther("10000"),     // minStakeAmount
        30 * 24 * 60 * 60,              // lockPeriod (30 days)
        500,                             // rewardRate (5%)
        contracts.OracleRegistry,        // oracleRegistry
        treasuryAddress                  // treasury
      ],
      "StakingManager"
    );
    if (success) results.verified.push("StakingManager");
    else results.failed.push("StakingManager");
  }
  
  // 3. Verify RewardDistributor
  if (contracts.RewardDistributor) {
    const success = await verifyContract(
      contracts.RewardDistributor,
      [
        contracts.OracleRegistry,        // oracleRegistry
        treasuryAddress,                 // treasury
        7 * 24 * 60 * 60                // defaultExpiryPeriod (7 days)
      ],
      "RewardDistributor"
    );
    if (success) results.verified.push("RewardDistributor");
    else results.failed.push("RewardDistributor");
  }
  
  // 4. Verify DisputeCoordinator
  if (contracts.DisputeCoordinator) {
    const success = await verifyContract(
      contracts.DisputeCoordinator,
      [
        contracts.OracleRegistry,        // oracleRegistry
        3,                               // minArbitrators
        7 * 24 * 60 * 60,               // votingPeriod (7 days)
        66,                              // quorumPercentage (66%)
        ethers.parseEther("100")        // appealBond
      ],
      "DisputeCoordinator"
    );
    if (success) results.verified.push("DisputeCoordinator");
    else results.failed.push("DisputeCoordinator");
  }
  
  // 5. Verify ProposalManager
  if (contracts.ProposalManager) {
    const success = await verifyContract(
      contracts.ProposalManager,
      [
        contracts.OracleRegistry,        // oracleRegistry
        treasuryAddress,                 // treasury
        minProposerBond,                 // minProposalBond
        minDisputerBond,                 // minChallengeBond
        livenessPeriod,                  // livenessPeriod
        8000                             // minConfidenceScore (80%)
      ],
      "ProposalManager"
    );
    if (success) results.verified.push("ProposalManager");
    else results.failed.push("ProposalManager");
  }
  
  // 6. Verify SlashingManager
  if (contracts.SlashingManager) {
    const success = await verifyContract(
      contracts.SlashingManager,
      [
        contracts.StakingManager,        // stakingManager
        treasuryAddress,                 // treasury
        3,                               // minApprovals
        24 * 60 * 60,                   // slashingDelay (1 day)
        5000,                            // maxSlashingPercentage (50%)
        ethers.parseEther("100000")     // permanentBanThreshold
      ],
      "SlashingManager"
    );
    if (success) results.verified.push("SlashingManager");
    else results.failed.push("SlashingManager");
  }
  
  console.log("\n=== Verifying Integration Contracts ===");
  
  // 7. Verify OracleAdapter
  if (contracts.OracleAdapter) {
    const success = await verifyContract(
      contracts.OracleAdapter,
      [
        contracts.OracleRegistry,        // oracleRegistry
        300,                             // cacheExpiry (5 minutes)
        5                                // maxFailures
      ],
      "OracleAdapter"
    );
    if (success) results.verified.push("OracleAdapter");
    else results.failed.push("OracleAdapter");
  }
  
  // 8. Verify EventMarket
  if (contracts.EventMarket) {
    const success = await verifyContract(
      contracts.EventMarket,
      [
        contracts.OracleRegistry,        // oracleRegistry
        treasuryAddress,                 // treasury
        100,                             // defaultPlatformFee (1%)
        1 * 60 * 60,                    // minMarketDuration (1 hour)
        365 * 24 * 60 * 60              // maxMarketDuration (365 days)
      ],
      "EventMarket"
    );
    if (success) results.verified.push("EventMarket");
    else results.failed.push("EventMarket");
  }
  
  // Print summary
  console.log("\n=== Verification Summary ===\n");
  console.log(`Total Contracts: ${Object.keys(contracts).length}`);
  console.log(`Successfully Verified: ${results.verified.length}`);
  console.log(`Failed: ${results.failed.length}`);
  
  if (results.verified.length > 0) {
    console.log("\n✓ Verified Contracts:");
    results.verified.forEach(name => {
      console.log(`  - ${name}: ${contracts[name]}`);
    });
  }
  
  if (results.failed.length > 0) {
    console.log("\n✗ Failed to Verify:");
    results.failed.forEach(name => {
      console.log(`  - ${name}: ${contracts[name]}`);
    });
    console.log("\nYou can manually verify these contracts using:");
    console.log("npx hardhat verify --network bnbTestnet <ADDRESS> <CONSTRUCTOR_ARGS>");
  }
  
  // Save verification results
  const verificationFile = path.join(__dirname, "../deployments/verification-results.json");
  const verificationData = {
    timestamp: new Date().toISOString(),
    network: deploymentData.network,
    chainId: deploymentData.chainId,
    results: results,
    contracts: contracts
  };
  
  fs.writeFileSync(verificationFile, JSON.stringify(verificationData, null, 2));
  console.log(`\n✓ Verification results saved to: ${verificationFile}`);
  
  console.log("\n=== Verification Complete ===\n");
  
  if (results.failed.length === 0) {
    console.log("🎉 All contracts verified successfully!");
  } else {
    console.log(`⚠️  ${results.failed.length} contract(s) failed verification. Please verify manually.`);
  }
  
  // Print BSCScan links
  console.log("\nView contracts on BSCScan:");
  Object.entries(contracts).forEach(([name, address]) => {
    const baseUrl = deploymentData.chainId === "97" 
      ? "https://testnet.bscscan.com" 
      : "https://bscscan.com";
    console.log(`${name}: ${baseUrl}/address/${address}#code`);
  });
  
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Verification failed:");
    console.error(error);
    process.exit(1);
  });