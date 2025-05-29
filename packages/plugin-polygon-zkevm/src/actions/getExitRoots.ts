import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type Content,
  logger,
} from '@elizaos/core';
import { z } from 'zod';
import { JsonRpcProvider } from 'ethers';

// Helper function to validate 32-byte hex strings
const isValidHex32Bytes = (hex: string): boolean => {
  return typeof hex === 'string' && /^0x[a-fA-F0-9]{64}$/.test(hex);
};

// Define the expected structure of the batch object from the RPC call
interface ZkEvmBatch {
  number: string;
  timestamp: string;
  globalExitRoot: string;
  mainnetExitRoot: string; // L1 root
  rollupExitRoot: string; // L2 root
  // ... other fields we might not need for this action
}

interface ZkEvmBatchRpcResponse {
  result?: ZkEvmBatch;
  error?: { message: string };
}

export const getExitRootsAction: Action = {
  name: 'GET_EXIT_ROOTS',
  similes: [
    'GET_L1_L2_EXIT_ROOTS',
    'FETCH_POLYGON_ZKEVM_EXIT_ROOTS',
    'GET_POLYGON_ZKEVM_LATEST_EXIT_ROOTS',
    'WHAT_ARE_THE_ZKEVM_EXIT_ROOTS',
  ],
  description:
    'Fetches the current L1 (mainnet) and L2 (rollup) exit root hashes for Polygon zkEVM.',

  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    const alchemyApiKey = runtime.getSetting('ALCHEMY_API_KEY') || process.env.ALCHEMY_API_KEY;
    const zkevmRpcUrl = runtime.getSetting('ZKEVM_RPC_URL') || process.env.ZKEVM_RPC_URL;

    if (!alchemyApiKey && !zkevmRpcUrl) {
      logger.warn('[getExitRootsAction] Neither ALCHEMY_API_KEY nor ZKEVM_RPC_URL is configured.');
      return false;
    }
    // Since "no inputs required", basic config check is sufficient
    // We can add more specific intent validation if needed later
    logger.info('[getExitRootsAction] Validation passed: Sufficient configuration found.');
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory, // Though not used for params, it's part of the signature
    _state?: State,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<Content> => {
    logger.info('[getExitRootsAction] Handler called.');

    const alchemyApiKey = runtime.getSetting('ALCHEMY_API_KEY') || process.env.ALCHEMY_API_KEY;
    const zkevmRpcUrlSetting = runtime.getSetting('ZKEVM_RPC_URL') || process.env.ZKEVM_RPC_URL;

    let l1Root: string | null = null;
    let l2Root: string | null = null;
    let methodUsed: string | null = null;
    const errorMessages: string[] = [];

    // 1. Attempt to use Alchemy API
    if (alchemyApiKey) {
      try {
        logger.info('[getExitRootsAction] Attempting to use Alchemy API.');
        // Polygon zkEVM Mainnet Alchemy URL
        const alchemyUrl = `https://polygonzkevm-mainnet.g.alchemy.com/v2/${alchemyApiKey}`;
        const requestBody = {
          jsonrpc: '2.0',
          id: 1,
          method: 'zkevm_getBatchByNumber',
          params: ['latest', false], // Get the latest batch, no transaction details
        };

        const response = await fetch(alchemyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(
            `Alchemy API request failed with status ${response.status}: ${response.statusText}`
          );
        }

        const data = (await response.json()) as ZkEvmBatchRpcResponse;

        if (data.error) {
          throw new Error(`Alchemy API returned error: ${data.error.message}`);
        }

        if (data.result && data.result.mainnetExitRoot && data.result.rollupExitRoot) {
          if (
            isValidHex32Bytes(data.result.mainnetExitRoot) &&
            isValidHex32Bytes(data.result.rollupExitRoot)
          ) {
            l1Root = data.result.mainnetExitRoot;
            l2Root = data.result.rollupExitRoot;
            methodUsed = 'Alchemy API';
            logger.info(`[getExitRootsAction] Roots from Alchemy: L1=${l1Root}, L2=${l2Root}`);
          } else {
            throw new Error('Alchemy API returned invalid root hash format.');
          }
        } else {
          throw new Error('Alchemy API did not return the expected exit roots.');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[getExitRootsAction] Error using Alchemy API: ${errorMessage}`);
        errorMessages.push(`Alchemy API failed: ${errorMessage}`);
        // Continue to fallback if Alchemy failed
      }
    }

    // 2. Fallback to JSON-RPC if Alchemy failed or not configured
    if ((!l1Root || !l2Root) && zkevmRpcUrlSetting) {
      try {
        logger.info('[getExitRootsAction] Attempting to use JSON-RPC fallback.');
        const provider = new JsonRpcProvider(zkevmRpcUrlSetting);
        const batch = (await provider.send('zkevm_getBatchByNumber', [
          'latest',
          false,
        ])) as ZkEvmBatch | null; // Type assertion based on expected output

        if (batch && batch.mainnetExitRoot && batch.rollupExitRoot) {
          if (isValidHex32Bytes(batch.mainnetExitRoot) && isValidHex32Bytes(batch.rollupExitRoot)) {
            l1Root = batch.mainnetExitRoot;
            l2Root = batch.rollupExitRoot;
            methodUsed = 'JSON-RPC';
            logger.info(`[getExitRootsAction] Roots from JSON-RPC: L1=${l1Root}, L2=${l2Root}`);
          } else {
            throw new Error('JSON-RPC returned invalid root hash format.');
          }
        } else {
          throw new Error('JSON-RPC did not return the expected exit roots or batch is null.');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[getExitRootsAction] Error using JSON-RPC: ${errorMessage}`);
        errorMessages.push(`JSON-RPC failed: ${errorMessage}`);
      }
    }

    // Handle result and errors
    if (l1Root && l2Root && methodUsed) {
      const responseText = `Polygon zkEVM Exit Roots (via ${methodUsed}):\nL1 (Mainnet) Root: ${l1Root}\nL2 (Rollup) Root: ${l2Root}`;
      const responseContent: Content = {
        text: responseText,
        actions: ['GET_EXIT_ROOTS'],
        data: {
          l1Root,
          l2Root,
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
      const comprehensiveErrorMessage = `Failed to retrieve Polygon zkEVM exit roots. Errors: ${errorMessages.join('; ')}`;
      logger.error(`[getExitRootsAction] ${comprehensiveErrorMessage}`);
      const errorContent: Content = {
        text: comprehensiveErrorMessage,
        actions: ['GET_EXIT_ROOTS'],
        data: {
          error: comprehensiveErrorMessage,
          details: errorMessages,
        },
      };
      if (callback) {
        await callback(errorContent);
      }
      // As per Eliza's error handling, throwing an error here makes sense
      // if the action's core purpose couldn't be fulfilled.
      throw new Error(comprehensiveErrorMessage);
    }
  },

  examples: [
    [
      {
        name: 'user1',
        content: {
          text: 'What are the current exit roots for Polygon zkEVM?',
        },
      },
      {
        name: 'assistant1',
        // This is a placeholder; actual roots will vary.
        content: {
          text: 'Polygon zkEVM Exit Roots (via Alchemy API):\nL1 (Mainnet) Root: 0x0123...abc\nL2 (Rollup) Root: 0x4567...def',
          actions: ['GET_EXIT_ROOTS'],
          data: {
            l1Root: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            l2Root: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567',
            source: 'Alchemy API',
            network: 'polygon-zkevm',
          },
        },
      },
    ],
    [
      {
        name: 'user2',
        content: {
          text: 'Fetch latest L1 and L2 exit roots on zkEVM.',
        },
      },
      {
        name: 'assistant2',
        content: {
          text: 'Polygon zkEVM Exit Roots (via JSON-RPC):\nL1 (Mainnet) Root: 0x...',
          actions: ['GET_EXIT_ROOTS'],
          data: {
            l1Root: '0x...', // actual hash
            l2Root: '0x...', // actual hash
            source: 'JSON-RPC',
          },
        },
      },
    ],
  ],
};
