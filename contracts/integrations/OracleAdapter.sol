// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

interface IChainlinkOracle {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

interface IPythOracle {
    function getPrice(bytes32 id) external view returns (int64 price, uint64 conf, int32 expo, uint publishTime);
}

interface IRedstoneOracle {
    function getValue() external view returns (uint256);
}

contract OracleAdapter is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    
    enum OracleType {
        CHAINLINK,
        PYTH,
        REDSTONE,
        PREDICTLINK
    }
    
    struct OracleConfig {
        OracleType oracleType;
        address oracleAddress;
        bool isActive;
        uint256 priority;
        uint256 lastUpdate;
        uint256 failureCount;
    }
    
    struct PriceData {
        int256 price;
        uint256 timestamp;
        uint256 confidence;
        OracleType source;
    }
    
    mapping(bytes32 => OracleConfig[]) public feedOracles;
    mapping(bytes32 => PriceData) public cachedData;
    mapping(bytes32 => uint256) public cacheTimestamp;
    mapping(OracleType => uint256) public oracleWeights;
    
    uint256 public cacheExpiry;
    uint256 public maxFailures;
    address public oracleRegistry;
    
    event OracleAdded(bytes32 indexed feedId, OracleType oracleType, address oracleAddress, uint256 priority);
    event OracleRemoved(bytes32 indexed feedId, address oracleAddress);
    event OracleStatusChanged(bytes32 indexed feedId, address oracleAddress, bool isActive);
    event DataFetched(bytes32 indexed feedId, int256 price, uint256 timestamp, OracleType source);
    event OracleFailed(bytes32 indexed feedId, address oracleAddress, string reason);
    event CacheUpdated(bytes32 indexed feedId, int256 price);
    
    error NoActiveOracles();
    error OracleFetchFailed();
    error InvalidOracleType();
    error ZeroAddress();
    error StaleData();
    error InvalidPrice();
    
    constructor(
        address _oracleRegistry, 
        uint256 _cacheExpiry,
        uint256 _maxFailures
    ) {
        if (_oracleRegistry == address(0)) revert ZeroAddress();
        
        oracleRegistry = _oracleRegistry;
        cacheExpiry = _cacheExpiry;
        maxFailures = _maxFailures;
        
        oracleWeights[OracleType.CHAINLINK] = 40;
        oracleWeights[OracleType.PYTH] = 30;
        oracleWeights[OracleType.REDSTONE] = 20;
        oracleWeights[OracleType.PREDICTLINK] = 10;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }
    
    function addOracle(
        bytes32 feedId,
        OracleType oracleType,
        address oracleAddress,
        uint256 priority
    ) external onlyRole(ADMIN_ROLE) {
        if (oracleAddress == address(0)) revert ZeroAddress();
        
        feedOracles[feedId].push(OracleConfig({
            oracleType: oracleType,
            oracleAddress: oracleAddress,
            isActive: true,
            priority: priority,
            lastUpdate: block.timestamp,
            failureCount: 0
        }));
        
        emit OracleAdded(feedId, oracleType, oracleAddress, priority);
    }
    
    function removeOracle(bytes32 feedId, address oracleAddress) external onlyRole(ADMIN_ROLE) {
        OracleConfig[] storage oracles = feedOracles[feedId];
        
        for (uint256 i = 0; i < oracles.length; i++) {
            if (oracles[i].oracleAddress == oracleAddress) {
                oracles[i].isActive = false;
                emit OracleRemoved(feedId, oracleAddress);
                break;
            }
        }
    }
    
    function setOracleStatus(
        bytes32 feedId, 
        address oracleAddress, 
        bool isActive
    ) external onlyRole(OPERATOR_ROLE) {
        OracleConfig[] storage oracles = feedOracles[feedId];
        
        for (uint256 i = 0; i < oracles.length; i++) {
            if (oracles[i].oracleAddress == oracleAddress) {
                oracles[i].isActive = isActive;
                emit OracleStatusChanged(feedId, oracleAddress, isActive);
                break;
            }
        }
    }
    
    function getData(bytes32 feedId) external view returns (PriceData memory) {
        if (block.timestamp - cacheTimestamp[feedId] < cacheExpiry) {
            return cachedData[feedId];
        }
        
        return _fetchFreshData(feedId);
    }
    
    function refreshData(bytes32 feedId) external onlyRole(OPERATOR_ROLE) returns (PriceData memory) {
        PriceData memory freshData = _fetchFreshData(feedId);
        
        cachedData[feedId] = freshData;
        cacheTimestamp[feedId] = block.timestamp;
        
        emit CacheUpdated(feedId, freshData.price);
        
        return freshData;
    }
    
    function _fetchFreshData(bytes32 feedId) internal view returns (PriceData memory) {
        OracleConfig[] memory oracles = feedOracles[feedId];
        
        if (oracles.length == 0) revert NoActiveOracles();
        
        PriceData[] memory prices = new PriceData[](oracles.length);
        uint256 validPriceCount = 0;
        
        for (uint256 i = 0; i < oracles.length; i++) {
            if (!oracles[i].isActive || oracles[i].failureCount >= maxFailures) {
                continue;
            }
            
            try this.fetchFromOracle(oracles[i]) returns (PriceData memory priceData) {
                prices[validPriceCount] = priceData;
                validPriceCount++;
            } catch {
                continue;
            }
        }
        
        if (validPriceCount == 0) revert OracleFetchFailed();
        
        return _aggregatePrices(prices, validPriceCount);
    }
    
    function fetchFromOracle(OracleConfig memory config) external view returns (PriceData memory) {
        if (config.oracleType == OracleType.CHAINLINK) {
            return _fetchChainlink(config.oracleAddress);
        } else if (config.oracleType == OracleType.PYTH) {
            return _fetchPyth(config.oracleAddress, bytes32(0));
        } else if (config.oracleType == OracleType.REDSTONE) {
            return _fetchRedstone(config.oracleAddress);
        } else {
            revert InvalidOracleType();
        }
    }
    
    function _fetchChainlink(address oracleAddress) internal view returns (PriceData memory) {
        IChainlinkOracle oracle = IChainlinkOracle(oracleAddress);
        
        (, int256 answer, , uint256 updatedAt, ) = oracle.latestRoundData();
        
        if (answer <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > cacheExpiry) revert StaleData();
        
        return PriceData({
            price: answer,
            timestamp: updatedAt,
            confidence: 95,
            source: OracleType.CHAINLINK
        });
    }
    
    function _fetchPyth(address oracleAddress, bytes32 priceId) internal view returns (PriceData memory) {
        IPythOracle oracle = IPythOracle(oracleAddress);
        
        (int64 price, uint64 conf, , uint publishTime) = oracle.getPrice(priceId);
        
        if (price <= 0) revert InvalidPrice();
        if (block.timestamp - publishTime > cacheExpiry) revert StaleData();
        
        uint256 confidence = conf > 0 ? uint256(100 - (conf * 100 / uint256(uint64(price)))) : 90;
        
        return PriceData({
            price: int256(price),
            timestamp: publishTime,
            confidence: confidence,
            source: OracleType.PYTH
        });
    }
    
    function _fetchRedstone(address oracleAddress) internal view returns (PriceData memory) {
        IRedstoneOracle oracle = IRedstoneOracle(oracleAddress);
        
        uint256 value = oracle.getValue();
        
        if (value == 0) revert InvalidPrice();
        
        return PriceData({
            price: int256(value),
            timestamp: block.timestamp,
            confidence: 85,
            source: OracleType.REDSTONE
        });
    }
    
    function _aggregatePrices(
        PriceData[] memory prices, 
        uint256 count
    ) internal view returns (PriceData memory) {
        if (count == 1) {
            return prices[0];
        }
        
        uint256 totalWeight = 0;
        int256 weightedSum = 0;
        uint256 latestTimestamp = 0;
        
        for (uint256 i = 0; i < count; i++) {
            uint256 weight = oracleWeights[prices[i].source];
            weightedSum += prices[i].price * int256(weight);
            totalWeight += weight;
            
            if (prices[i].timestamp > latestTimestamp) {
                latestTimestamp = prices[i].timestamp;
            }
        }
        
        int256 aggregatedPrice = weightedSum / int256(totalWeight);
        
        uint256 avgConfidence = 0;
        for (uint256 i = 0; i < count; i++) {
            avgConfidence += prices[i].confidence;
        }
        avgConfidence = avgConfidence / count;
        
        return PriceData({
            price: aggregatedPrice,
            timestamp: latestTimestamp,
            confidence: avgConfidence,
            source: OracleType.PREDICTLINK
        });
    }
    
    function updateOracleWeights(
        OracleType oracleType,
        uint256 weight
    ) external onlyRole(ADMIN_ROLE) {
        oracleWeights[oracleType] = weight;
    }
    
    function updateCacheExpiry(uint256 _cacheExpiry) external onlyRole(ADMIN_ROLE) {
        cacheExpiry = _cacheExpiry;
    }
    
    function updateMaxFailures(uint256 _maxFailures) external onlyRole(ADMIN_ROLE) {
        maxFailures = _maxFailures;
    }
    
    function getFeedOracles(bytes32 feedId) external view returns (OracleConfig[] memory) {
        return feedOracles[feedId];
    }
    
    function getCachedData(bytes32 feedId) external view returns (PriceData memory, uint256) {
        return (cachedData[feedId], cacheTimestamp[feedId]);
    }
    
    function isCacheValid(bytes32 feedId) external view returns (bool) {
        return block.timestamp - cacheTimestamp[feedId] < cacheExpiry;
    }
}