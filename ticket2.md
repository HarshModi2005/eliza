# Ticket: Implement Core Staking Write Operations (Polygon Plugin)

**Ticket Type:** Dev Ticket
**Priority:** P1
**Epic:** Implement Polygon Plugin MVP
**Assignee:** TBD
**Reporter:** AI Assistant
**Dependencies:** `plugin-setup`, `core-interaction`, `gas-service`, `staking-read` (implicitly uses the same ABIs/contracts), ABIs for `StakeManager` and `ValidatorShare`.

---

## 1. Summary

This ticket focuses on implementing the core **write** operations for staking on Polygon PoS via interactions with the **Ethereum L1** contracts. It covers delegating MATIC/POL to a validator, undelegating (initiating the unbonding period), withdrawing accumulated rewards, and a convenience function for restaking rewards. These actions require constructing, signing, and sending transactions to the `ValidatorShare` contract associated with the target validator.

---

## 2. Detailed Description & Tasks

The goal is to create functions within the plugin that allow users to perform the primary staking actions, handling transaction creation, gas estimation, signing, and broadcasting.

**Prerequisites:**

- Plugin initialized with L1 provider and configured private key (`plugin-setup`).
- Core RPC wrappers, especially `eth_sendRawTransaction` and `eth_call` (`core-interaction`).
- Gas estimation service implemented (`gas-service`).
- ABIs for `StakeManager` and `ValidatorShare` available (`staking-read`).

**Tasks:**

1.  **Helper Function: Get ValidatorShare Contract Instance:**

    - Create or reuse a helper function that takes a `validatorId` and returns a ready-to-use, signer-aware contract instance (`ethers.Contract` or equivalent) for the corresponding `ValidatorShare` contract on L1.
    - This involves:
      - Calling `StakeManager.getValidatorContract(validatorId)` using the L1 provider.
      - Instantiating the `ValidatorShare` contract using the retrieved address, the `ValidatorShare` ABI, and the wallet/signer derived from the configured `PRIVATE_KEY`.

2.  **Implement `delegate(validatorId: number, amountWei: bigint)` function:**

    - Get the signer-aware `ValidatorShare` contract instance using the helper function.
    - **Function to call:** `buyVoucher(uint256 _amount, uint256 _minSharesToMint)`
    - **Parameters:**
      - `_amount`: The `amountWei` parameter (amount of MATIC/POL to delegate).
      - `_minSharesToMint`: Set to `0` for simplicity, allowing the contract to calculate the minimum based on the current exchange rate.
    - **Transaction Details:** The `value` field of the transaction MUST be set to `amountWei`, as the user is sending MATIC/POL with this call.
    - **Workflow:**
      - Get gas price estimates using the `gas-service`.
      - Estimate gas for the `buyVoucher` call (including the `value`). Handle potential estimation failures.
      - Construct the transaction object (to, data, value, gasLimit, maxFeePerGas, maxPriorityFeePerGas).
      - Sign the transaction using the configured private key.
      - Broadcast the signed transaction using the `eth_sendRawTransaction` wrapper (via the L1 provider).
      - Return the transaction hash. Optionally, wait for transaction confirmation and return the receipt.

3.  **Implement `undelegate(validatorId: number, sharesAmountWei: bigint)` function:**

    - Get the signer-aware `ValidatorShare` contract instance.
    - **Function to call:** `sellVoucher_new(uint256 _shares, uint256 _maxStakeToBurn)` (Verify exact function name from ABI, might be `sellVoucher` or `unbond`).
    - **Parameters:**
      - `_shares`: The amount of validator shares to undelegate (this is _not_ MATIC amount, it's the amount of the share token the user owns). The user might need a separate read function (potentially added to `staking-read`) to know their share balance.
      - `_maxStakeToBurn`: Set to `0` to let the contract handle the conversion, or potentially calculate an estimate with some slippage. `0` is likely safer.
    - **Transaction Details:** The `value` field is `0`.
    - **Workflow:** Similar to delegate - estimate gas, construct (no `value`), sign, broadcast. Return tx hash/receipt.

4.  **Implement `withdrawRewards(validatorId: number)` function:**

    - Get the signer-aware `ValidatorShare` contract instance.
    - **Function to call:** `withdrawRewards()` (Verify exact name from ABI).
    - **Parameters:** None required by the function itself.
    - **Transaction Details:** The `value` field is `0`.
    - **Workflow:** Similar to undelegate - estimate gas, construct (no `value`), sign, broadcast. Return tx hash/receipt.

5.  **Implement `restakeRewards(validatorId: number)` function (Convenience):**

    - This function orchestrates withdrawing and then re-delegating.
    - **Workflow:**
      - Call the internal logic for `withdrawRewards(validatorId)`.
      - _(Optional but Recommended):_ Wait for the withdrawal transaction to be confirmed (e.g., using `tx.wait()` if using ethers).
      - Call `getDelegatorInfo(validatorId, userAddress)` (from `staking-read`) _before_ the withdrawal to get the `pendingRewards` amount. Alternatively, parse the withdrawal transaction receipt for the amount withdrawn if reliable events are emitted.
      - Call the internal logic for `delegate(validatorId, withdrawnAmountWei)`.
      - Return the transaction hash/receipt of the _delegate_ transaction (or potentially both). Handle potential failures in either step.

6.  **Error Handling:**
    - Implement robust error handling for:
      - Failures in getting the `ValidatorShare` address.
      - Gas estimation failures (e.g., user has insufficient funds, contract logic prevents action).
      - Transaction signing errors.
      - Transaction broadcast errors.
      - Contract reverts during transaction execution (check receipt status).

---

## 3. Acceptance Criteria

- Functions `delegate`, `undelegate`, `withdrawRewards`, and `restakeRewards` are implemented.
- All functions correctly interact with the appropriate `ValidatorShare` contract on the **Ethereum L1 network** using the configured L1 provider and signer.
- `delegate` correctly sends the specified MATIC/POL amount as the transaction `value`.
- `undelegate` and `withdrawRewards` send transactions with `value` 0.
- Functions utilize the `gas-service` for gas price estimation.
- Transactions are correctly constructed, signed using the plugin's configured private key, and broadcast via the `eth_sendRawTransaction` wrapper.
- Functions return the transaction hash upon successful broadcast (or receipt if waiting for confirmation).
- Error scenarios (e.g., insufficient funds for gas/delegation, invalid validator ID, contract reverts) are handled gracefully.
- Unit tests mock contract interactions and verify correct transaction construction and signing for each action.
- _(Optional but Recommended):_ Integration tests are performed against a testnet (e.g., Sepolia using the testnet `StakeManager` address) to verify the end-to-end flow of each staking action using a funded test wallet.
- Code adheres to project linting and formatting standards.

---

## 4. Notes/Considerations

- All interactions are on **Ethereum L1**.
- The user needs MATIC (on L1) for delegation and ETH (on L1) for gas fees.
- `undelegate` requires the user's _share_ balance, not MATIC balance. Consider if a `getDelegatorShares(validatorId, delegatorAddress)` function is needed in `staking-read`.
- Confirm exact function names (`sellVoucher_new` vs `sellVoucher`/`unbond`, `withdrawRewards`) from the `ValidatorShare` ABI.
- Decide on the return value strategy (return hash immediately vs. wait for confirmation/receipt). Waiting provides more certainty but takes longer.
- Restaking requires careful sequencing and potentially fetching the reward amount between steps.

# Updated PR Description for Polygon Plugin Implementation

## Relates to

Issues:

- [#450 Initialize Eliza Plugin Structure and Configuration (Polygon)](https://github.com/Sifchain/sa-eliza/issues/450)
- [#453 Implement Staking Read Operations (Polygon Plugin)](https://github.com/Sifchain/sa-eliza/issues/453)
- [#454 Implement Core Staking Write Operations (Polygon Plugin)](https://github.com/Sifchain/sa-eliza/issues/454)

This PR implements the core foundation and staking operations for the Polygon Plugin as part of the "Implement Polygon Plugin MVP" epic.

## Risks

- **Medium: L1 Gas Estimation Inaccuracy:** The current `GasService` primarily uses L2 (PolygonScan) gas oracles. When used for L1 Ethereum transactions (staking, bridging), this can lead to inaccurate gas estimations, potentially causing transactions to be underpriced (fail) or overpriced.
- **Medium: Missing Heimdall Governance:** The P1 functionality for Polygon-specific governance (interacting with Heimdall) is not implemented. Current governance actions target EVM-based smart contracts. Users expecting native Polygon governance via Heimdall will not find this functionality.
- **Low: User-Facing `withdrawRewards` Action Stub:** The LLM-enabled `withdrawRewards` action is a non-functional stub. The core logic exists via the programmatic `WITHDRAW_REWARDS_L1` action and the `PolygonRpcService`.

## Background

### What does this PR do?

This PR implements three key components of the Polygon Plugin MVP:

1. **Plugin Foundation (#450):**

   - Establishes the plugin package structure with proper configuration and boilerplate
   - Implements configuration handling for RPC URLs, private keys, and API keys
   - Creates the provider structure and plugin lifecycle methods

2. **Staking Read Operations (#453):**

   - Integrates StakeManager and ValidatorShare ABIs for interacting with L1 staking contracts
   - Implements `getValidatorInfo(validatorId)` to fetch validator status, total stake, and commission rate
   - Implements `getDelegatorInfo(validatorId, delegatorAddress)` to get delegator stake and pending rewards
   - Creates robust error handling for contract interactions

3. **Staking Write Operations (#454):**
   - Implements `delegate(validatorId, amountWei)` for staking MATIC/POL to validators
   - Implements `undelegate(validatorId, sharesAmountWei)` for initiating the unbonding process
   - Implements `withdrawRewards(validatorId)` for claiming accumulated staking rewards
   - Implements `restakeRewards(validatorId)` as a convenience function
   - Handles transaction creation, gas estimation, signing, and broadcasting

Additional functionality implemented:

- L1 Native Bridge deposit operations to the Polygon PoS Bridge
- L2 interaction capabilities for basic operations
- Checkpoint status verification
- EVM-based governance operation stubs
- Gas price estimation service for L2 transactions

### What kind of change is this?

Features (non-breaking change which adds functionality)

### Why are we doing this? Any context or related work?

This work establishes the dedicated `@elizaos/plugin-polygon` as outlined in the "Implement Polygon Plugin MVP" epic. The goal is to create a focused plugin capable of handling Polygon-specific interactions (L1 staking, native bridge, Heimdall governance) that go beyond the scope of a generic EVM plugin. This PR implements the core foundation and staking operations that form the backbone of the plugin.

## Documentation changes needed?

My changes do not require a change to the project documentation. (The plugin includes its own `README.md` which serves as initial documentation for its features and setup).

## Testing

### Where should a reviewer start?

1. **`packages/plugin-polygon/README.md`**: For an overview of the plugin's intended features and setup.
2. **`packages/plugin-polygon/src/index.ts`**: For the main plugin definition, configuration handling, and registration of components.
3. **`packages/plugin-polygon/src/services/PolygonRpcService.ts`**: To understand the core logic for L1 staking, L1 bridging, and L2 interactions.
4. **`packages/plugin-polygon/src/services/GasService.ts`**: To review the L2 gas oracle integration.
5. **Key staking files:**
   - `packages/plugin-polygon/src/abi/`: To verify the StakeManager and ValidatorShare ABIs are properly included
   - `packages/plugin-polygon/src/actions/delegate.ts`: For L1 staking operations
   - `packages/plugin-polygon/src/actions/getValidatorInfo.ts` and `getDelegatorInfo.ts`: For staking read operations

### Detailed testing steps

Manual testing should focus on the implemented staking functionality:

**Setup:**

1. Navigate to the `packages/plugin-polygon` directory.
2. Create a `.env` file based on `.env.example`.
3. Populate the `.env` file with valid:
   - `POLYGON_RPC_URL` (Polygon PoS RPC endpoint)
   - `ETHEREUM_RPC_URL` (Ethereum Mainnet RPC endpoint for L1)
   - `PRIVATE_KEY` (for a wallet with funds on both L1 and L2 for testing)
   - `POLYGONSCAN_KEY` (API key for PolygonScan)

**Testing Staking Read Operations:**

1. Test `getValidatorInfo` by querying information for known validator IDs
2. Test `getDelegatorInfo` by querying information for known delegator addresses
3. Verify error handling for invalid validator IDs or non-delegating addresses

**Testing Staking Write Operations:**

1. Test `delegate` by staking a small amount of MATIC to a known validator
2. Test `withdrawRewards` to claim any pending rewards
3. Test `undelegate` to initiate withdrawal of a small amount
4. Test `restakeRewards` to compound rewards

**Additional Testing:**

1. Verify the bridge deposit functionality works with small test amounts
2. Confirm checkpoint status checking returns valid results
3. Test gas estimation for L2 transactions
