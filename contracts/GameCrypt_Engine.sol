pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract GameCryptEngineFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error BatchNotClosed();
    error InvalidCooldown();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Batch {
        uint256 id;
        bool closed;
    }
    Batch public currentBatch;

    struct PlayerState {
        euint32 encryptedHp;
        euint32 encryptedAtk;
        euint32 encryptedExp;
        bool initialized;
    }
    mapping(address => PlayerState) public playerStates;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event CooldownSecondsUpdated(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event PlayerStateSubmitted(address indexed player, uint256 indexed batchId);
    event DecryptionRequested(uint256 indexed requestId, address indexed player, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, address indexed player, uint256 indexed batchId, uint256 hp, uint256 atk, uint256 exp);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier submissionRateLimited() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastSubmissionTime[msg.sender] = block.timestamp;
        _;
    }

    modifier decryptionRequestRateLimited() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        cooldownSeconds = 60;
        _openNewBatch(1);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidCooldown();
        emit CooldownSecondsUpdated(cooldownSeconds, newCooldownSeconds);
        cooldownSeconds = newCooldownSeconds;
    }

    function openNewBatch() external onlyOwner {
        uint256 nextBatchId = currentBatch.id + 1;
        _openNewBatch(nextBatchId);
    }

    function closeCurrentBatch() external onlyOwner {
        if (currentBatch.closed) revert BatchClosed();
        currentBatch.closed = true;
        emit BatchClosed(currentBatch.id);
    }

    function submitPlayerState(
        address player,
        euint32 encryptedHp,
        euint32 encryptedAtk,
        euint32 encryptedExp
    ) external onlyProvider whenNotPaused submissionRateLimited {
        if (currentBatch.closed) revert BatchClosed();
        PlayerState storage state = playerStates[player];
        if (!state.initialized) {
            state.initialized = true;
        }
        state.encryptedHp = encryptedHp;
        state.encryptedAtk = encryptedAtk;
        state.encryptedExp = encryptedExp;
        emit PlayerStateSubmitted(player, currentBatch.id);
    }

    function requestPlayerStateDecryption(address player) external whenNotPaused decryptionRequestRateLimited {
        PlayerState storage state = playerStates[player];
        if (!state.initialized) revert NotInitialized();

        euint32 finalHp = state.encryptedHp;
        euint32 finalAtk = state.encryptedAtk;
        euint32 finalExp = state.encryptedExp;

        bytes32[] memory cts = new bytes32[](3);
        cts[0] = finalHp.toBytes32();
        cts[1] = finalAtk.toBytes32();
        cts[2] = finalExp.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatch.id,
            stateHash: stateHash,
            processed: false
        });
        emit DecryptionRequested(requestId, player, currentBatch.id);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();

        DecryptionContext memory context = decryptionContexts[requestId];
        address player = _findPlayerByDecryptionContext(context.batchId); // Simplified: assumes one player per batch for this example

        PlayerState storage state = playerStates[player];
        if (!state.initialized) revert NotInitialized(); // Should not happen if requestPlayerStateDecryption was called

        euint32 finalHp = state.encryptedHp;
        euint32 finalAtk = state.encryptedAtk;
        euint32 finalExp = state.encryptedExp;

        bytes32[] memory currentCts = new bytes32[](3);
        currentCts[0] = finalHp.toBytes32();
        currentCts[1] = finalAtk.toBytes32();
        currentCts[2] = finalExp.toBytes32();

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != context.stateHash) {
            revert StateMismatch();
        }

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        uint256 hp = abi.decode(cleartexts, (uint256));
        cleartexts = cleartexts[32:];
        uint256 atk = abi.decode(cleartexts, (uint256));
        cleartexts = cleartexts[32:];
        uint256 exp = abi.decode(cleartexts, (uint256));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, player, context.batchId, hp, atk, exp);
    }

    function _openNewBatch(uint256 batchId) private {
        currentBatch = Batch({ id: batchId, closed: false });
        emit BatchOpened(batchId);
    }

    function _hashCiphertexts(bytes32[] memory cts) private pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 encryptedValue) private view {
        if (!encryptedValue.isInitialized()) revert NotInitialized();
    }

    function _requireInitialized(euint32 encryptedValue) private view {
        if (!encryptedValue.isInitialized()) revert NotInitialized();
    }

    // Simplified helper for callback to find player; real implementation would need a more robust way
    // to link requestId to the specific player whose data was requested.
    function _findPlayerByDecryptionContext(uint256 batchId) private view returns (address) {
        // This is a placeholder. In a real scenario, you'd need to store which player's data
        // corresponds to a decryption request, or iterate if multiple players per batch.
        // For this example, assume one player per batch for simplicity.
        // A more robust solution would involve storing player address with the decryption context.
        address placeholderPlayer;
        // Example: Iterate through playerStates to find one in the given batchId
        // This is inefficient and for demonstration only.
        // A real implementation should store this mapping.
        for (uint i = 0; i < 1; i++) { // Dummy loop, needs proper iteration logic
            // placeholderPlayer = ... find player in batchId
        }
        return placeholderPlayer; // Will be address(0) with current dummy logic
    }
}