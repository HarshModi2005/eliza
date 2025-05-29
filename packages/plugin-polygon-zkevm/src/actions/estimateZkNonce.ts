import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type Content,
  logger,
  ModelType,
  composePromptFromState,
} from '@elizaos/core';
import { z } from 'zod';
import { JsonRpcProvider, isAddress } from 'ethers';
import { extractAddressForZkNonceTemplate } from '../templates'; // Import the new template

// Helper to convert hex string (e.g., "0x1a") to decimal string (e.g., "26")
const hexToDecimalString = (hexString: string): string => {
  return BigInt(hexString).toString();
};

interface EthGetTransactionCountResponse {
  result?: string; // Hex string like "0x1a"
  error?: { message: string };
}

export const estimateZkNonceAction: Action = {
  name: 'ESTIMATE_TRANSACTION_ZK_COUNTER',
  similes: [
    'GET_ZKNONCE',
    'FETCH_ACCOUNT_ZK_COUNTER',
    'GET_NEXT_ZKEVM_NONCE',
    'WHAT_IS_THE_ZK_NONCE_FOR_ADDRESS',
  ],
  description: 'Estimates the next zkCounter (nonce) for a given address on Polygon zkEVM.',

  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    const alchemyApiKey = runtime.getSetting('ALCHEMY_API_KEY') || process.env.ALCHEMY_API_KEY;
    const zkevmRpcUrl = runtime.getSetting('ZKEVM_RPC_URL') || process.env.ZKEVM_RPC_URL;

    if (!alchemyApiKey && !zkevmRpcUrl) {
      logger.warn(
        '[estimateZkNonceAction] Neither ALCHEMY_API_KEY nor ZKEVM_RPC_URL is configured.'
      );
      return false;
    }
    // Further validation for address presence can be implicitly handled by the handler's LLM call.
    // If LLM can't find an address, the handler will error out.
    logger.info('[estimateZkNonceAction] Validation passed: Sufficient configuration found.');
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State, // state is needed for composePromptFromState
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<Content> => {
    logger.info('[estimateZkNonceAction] Handler called.');

    const alchemyApiKey = runtime.getSetting('ALCHEMY_API_KEY') || process.env.ALCHEMY_API_KEY;
    const zkevmRpcUrlSetting = runtime.getSetting('ZKEVM_RPC_URL') || process.env.ZKEVM_RPC_URL;
    let addressInput: { address?: string; error?: string } | null = null;

    try {
      addressInput = (await runtime.useModel(ModelType.OBJECT_LARGE, {
        prompt: composePromptFromState({
          state,
          template: extractAddressForZkNonceTemplate,
        }),
      })) as { address?: string; error?: string };

      logger.debug('[estimateZkNonceAction] Parsed LLM parameters:', addressInput);

      if (addressInput?.error) {
        throw new Error(`LLM extraction error: ${addressInput.error}`);
      }
      if (!addressInput?.address || !isAddress(addressInput.address)) {
        throw new Error('Invalid or missing Ethereum address extracted by LLM.');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        `[estimateZkNonceAction] Failed to extract or validate address: ${errorMessage}`
      );
      // It's important to still call the callback with the error if provided
      const errorContent: Content = {
        text: `Failed to get zkNonce: ${errorMessage}`,
        actions: ['ESTIMATE_TRANSACTION_ZK_COUNTER'],
        data: { error: errorMessage },
      };
      if (callback) {
        await callback(errorContent);
      }
      throw new Error(`Failed to get zkNonce: ${errorMessage}`);
    }

    const targetAddress = addressInput.address;
    let nonceHex: string | null = null;
    let methodUsed: string | null = null;
    const errorMessages: string[] = [];

    // 1. Attempt to use Alchemy API
    if (alchemyApiKey) {
      try {
        logger.info(`[estimateZkNonceAction] Attempting Alchemy API for address: ${targetAddress}`);
        const alchemyUrl = `https://polygonzkevm-mainnet.g.alchemy.com/v2/${alchemyApiKey}`;
        const requestBody = {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionCount',
          params: [targetAddress, 'pending'],
        };

        const response = await fetch(alchemyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(`Alchemy API request failed: ${response.status} ${response.statusText}`);
        }
        const data = (await response.json()) as EthGetTransactionCountResponse;

        if (data.error) {
          throw new Error(`Alchemy API error: ${data.error.message}`);
        }
        if (typeof data.result === 'string') {
          nonceHex = data.result;
          methodUsed = 'Alchemy API';
          logger.info(
            `[estimateZkNonceAction] Nonce from Alchemy for ${targetAddress}: ${nonceHex}`
          );
        } else {
          throw new Error('Alchemy API returned invalid or missing nonce result.');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[estimateZkNonceAction] Error using Alchemy API: ${errorMessage}`);
        errorMessages.push(`Alchemy API failed: ${errorMessage}`);
      }
    }

    // 2. Fallback to JSON-RPC
    if (nonceHex === null && zkevmRpcUrlSetting) {
      try {
        logger.info(`[estimateZkNonceAction] Attempting JSON-RPC for address: ${targetAddress}`);
        const provider = new JsonRpcProvider(zkevmRpcUrlSetting);
        // eth_getTransactionCount returns the count as a hex string
        const resultHex = await provider.send('eth_getTransactionCount', [
          targetAddress,
          'pending',
        ]);

        if (typeof resultHex === 'string' && /^0x[0-9a-fA-F]+$/.test(resultHex)) {
          nonceHex = resultHex;
          methodUsed = 'JSON-RPC';
          logger.info(`[estimateZkNonceAction] Nonce from RPC for ${targetAddress}: ${nonceHex}`);
        } else {
          throw new Error('JSON-RPC returned invalid or missing nonce result.');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[estimateZkNonceAction] Error using JSON-RPC: ${errorMessage}`);
        errorMessages.push(`JSON-RPC failed: ${errorMessage}`);
      }
    }

    // Handle result
    if (nonceHex !== null && methodUsed) {
      const decimalNonce = hexToDecimalString(nonceHex);
      const responseText = `The next zkCounter (nonce) for address ${targetAddress} is ${decimalNonce} (via ${methodUsed}).`;
      const responseContent: Content = {
        text: responseText,
        actions: ['ESTIMATE_TRANSACTION_ZK_COUNTER'],
        data: {
          address: targetAddress,
          zkNonceHex: nonceHex,
          zkNonceDecimal: decimalNonce,
          source: methodUsed,
          network: 'polygon-zkevm',
          timestamp: Date.now(),
        },
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } else {
      const comprehensiveErrorMessage = `Failed to estimate zkCounter for ${targetAddress}. Errors: ${errorMessages.join('; ')}`;
      logger.error(`[estimateZkNonceAction] ${comprehensiveErrorMessage}`);
      const errorContent: Content = {
        text: comprehensiveErrorMessage,
        actions: ['ESTIMATE_TRANSACTION_ZK_COUNTER'],
        data: {
          error: comprehensiveErrorMessage,
          address: targetAddress,
          details: errorMessages,
        },
      };
      if (callback) {
        await callback(errorContent);
      }
      throw new Error(comprehensiveErrorMessage);
    }
  },

  examples: [
    [
      {
        name: 'user1',
        content: {
          text: 'What is the next zkCounter for address 0x123abc...def456 on Polygon zkEVM?',
        },
      },
      {
        name: 'assistant1',
        content: {
          text: 'The next zkCounter (nonce) for address 0x123abc...def456 is 5 (via Alchemy API).',
          actions: ['ESTIMATE_TRANSACTION_ZK_COUNTER'],
          data: {
            address: '0x123abc...def456',
            zkNonceHex: '0x5',
            zkNonceDecimal: '5',
            source: 'Alchemy API',
          },
        },
      },
    ],
    [
      {
        name: 'user2',
        content: {
          text: 'Get zk-nonce for 0x789xyz...abc123',
        },
      },
      {
        name: 'assistant2',
        content: {
          text: 'The next zkCounter (nonce) for address 0x789xyz...abc123 is 0 (via JSON-RPC).',
          actions: ['ESTIMATE_TRANSACTION_ZK_COUNTER'],
          data: {
            address: '0x789xyz...abc123',
            zkNonceHex: '0x0',
            zkNonceDecimal: '0',
            source: 'JSON-RPC',
          },
        },
      },
    ],
  ],
};
