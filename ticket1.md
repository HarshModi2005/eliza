# Ticket: Implement Staking Read Operations (Polygon Plugin)

**Ticket Type:** Dev Ticket
**Priority:** P1
**Epic:** Implement Polygon Plugin MVP
**Assignee:** TBD
**Reporter:** AI Assistant
**Dependencies:** `plugin-setup` (for config/L1 provider), `core-interaction` (for contract interaction wrappers/`eth_call`)

---

## 1. Summary

This ticket involves implementing the functionality to read staking-related information from the Polygon PoS contracts deployed on the **Ethereum L1 network**. Specifically, it covers fetching details about validators (like status, total stake, commission) and information about delegators associated with a specific validator (delegated amount, pending rewards).

---

## 2. Detailed Description & Tasks

The core task is to interact with the `StakeManager` and `ValidatorShare` contracts on Ethereum L1 using their ABIs and the L1 RPC provider configured in the plugin setup.

**Prerequisites:**

- Obtain the verified ABI JSON for the `StakeManager` contract (`0x5e3Ef299fDDf15eAa0432E6e66473ace8c13D908` on Ethereum Mainnet) from Etherscan or the `pos-contracts` repository.
- Obtain the verified ABI JSON for the `ValidatorShare` contract (the ABI is the same for all validators; find one instance on Etherscan or in the `pos-contracts` repository).
- Add these ABI files to a suitable location within the plugin package (e.g., `src/abi/`).

**Tasks:**

1.  **Contract Initialization:**

    - Ensure the plugin can initialize `ethers.Contract` (or `viem` equivalent) instances for interacting with L1 contracts using the L1 provider and the loaded ABIs.
    - Instantiate a persistent `StakeManager` contract instance using its address and ABI.

2.  **Implement `getValidatorInfo(validatorId: number)` function:**

    - This function should take a `validatorId` as input.
    - Call the `validators(uint256 validatorId)` view function on the `StakeManager` contract instance.
    - The `validators` function typically returns a struct containing multiple details. Parse this struct to extract:
      - Validator Status (Active, Unbonding, etc. - requires mapping the enum/status code from the contract).
      - Total Stake Amount (delegated + self-stake).
      - Commission Rate.
      - Other relevant details returned by the struct (e.g., signer address, activation epoch).
    - Define a clear return type (e.g., `ValidatorInfo`) for this structured data.
    - Handle potential errors (e.g., invalid `validatorId`).

3.  **Implement `getDelegatorInfo(validatorId: number, delegatorAddress: string)` function:**

    - This function should take a `validatorId` and the `delegatorAddress` as input.
    - **Step 1: Get ValidatorShare Address:** Call the `getValidatorContract(uint256 validatorId)` view function on the `StakeManager` instance to retrieve the specific `ValidatorShare` contract address for the given `validatorId`. Handle cases where the validator might not have a contract (e.g., doesn't accept delegations).
    - **Step 2: Instantiate ValidatorShare Contract:** Create an instance of the `ValidatorShare` contract using the retrieved address and the `ValidatorShare` ABI.
    - **Step 3: Get Delegated Amount:** Call the `getTotalStake(address delegator)` view function (or similar, verify exact name in ABI) on the `ValidatorShare` instance, passing the `delegatorAddress`. This returns the amount delegated by that specific address to this validator.
    - **Step 4: Get Pending Rewards:** Call the `pendingRewards(address delegator)` view function (or similar) on the `ValidatorShare` instance, passing the `delegatorAddress`. This returns the currently claimable rewards for that delegator from this validator.
    - Define a clear return type (e.g., `DelegatorInfo`) containing the delegated amount and pending rewards.
    - Handle potential errors (e.g., invalid `validatorId`, address not delegating to this validator).

4.  **Type Definitions:**

    - Define clear TypeScript interfaces for `ValidatorInfo` and `DelegatorInfo` return types, matching the data retrieved from the contracts.

5.  **Error Handling:**

    - Implement robust error handling for contract calls (e.g., network errors, contract reverts, invalid inputs). Ensure errors are propagated or logged appropriately.

6.  **Unit Testing:**
    - Write unit tests for the read functions:
      - Mock the L1 provider and contract calls.
      - Provide mock return data for `validators`, `getValidatorContract`, `getTotalStake`, `pendingRewards`.
      - Verify that the functions correctly parse the results and return the expected `ValidatorInfo` and `DelegatorInfo` objects.
      - Test edge cases like invalid IDs/addresses or validators not accepting delegations.

---

## 3. Acceptance Criteria

- ABIs for `StakeManager` and `ValidatorShare` are included in the plugin package.
- Functions `getValidatorInfo(validatorId)` and `getDelegatorInfo(validatorId, delegatorAddress)` are implemented.
- `getValidatorInfo` successfully queries the `StakeManager` contract on L1 and returns parsed validator status, total stake, and commission rate.
- `getDelegatorInfo` successfully queries the `StakeManager` for the `ValidatorShare` address and then queries that `ValidatorShare` contract on L1 to return the delegator's specific stake amount and pending rewards.
- Functions use the configured L1 RPC provider.
- Return types are clearly defined.
- Contract call errors are handled gracefully.
- Unit tests verify the correct parsing and handling of data returned from mocked contract calls.
- Code adheres to project linting and formatting standards.

---

## 4. Notes/Considerations

- All interactions in this ticket occur on the **Ethereum L1 network**, not Polygon PoS L2. The L1 provider must be used.
- The exact structure returned by `StakeManager.validators()` needs to be confirmed by inspecting the ABI to ensure all required fields (status, stake, commission) are correctly extracted.
- Function names on `ValidatorShare` (`getTotalStake`, `pendingRewards`) should be confirmed from its ABI.
- Consider potential performance implications if querying many validators/delegators frequently, although these are read-only view calls.
