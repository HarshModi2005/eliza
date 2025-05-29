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
import { JsonRpcProvider, Wallet, isAddress, parseEther, parseUnits } from 'ethers';
import { extractParamsForSendL2TransactionTemplate } from '../templates';

const POLYGON_ZKEVM_CHAIN_ID = 1101n;

const extractedParamsSchema = z.object({
  toAddress: z.string().refine(isAddress, { message: 'Invalid toAddress format.' }),
  value: z
    .string()
    .regex(/^\d*\.?\d+$/, { message: 'Invalid value format, should be a number string.' }),
  gasLimit: z
    .string()
    .regex(/^\d+$/, { message: 'Invalid gasLimit format, should be an integer string.' })
    .optional(),
  gasPrice: z
    .string()
    .regex(/^\d*\.?\d+$/, { message: 'Invalid gasPrice format, should be a number string (Gwei).' })
    .optional(),
  error: z.string().optional(),
});

type SendL2TransactionParams = z.infer<typeof extractedParamsSchema>;

export const sendL2TransactionAction: Action = {
  name: 'SEND_L2_TRANSACTION',
  similes: [
    'SEND_ZKEVM_ETH_TRANSFER',
    'MAKE_L2_ETH_PAYMENT',
    'TRANSFER_ETH_ON_POLYGON_ZKEVM',
    'EXECUTE_NATIVE_TOKEN_TRANSFER_ZKEVM',
  ],
  description:
    'Sends a native ETH (L2) transaction on Polygon zkEVM. Requires recipient address and value. Gas parameters are optional.',
  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    const privateKey = runtime.getSetting('PRIVATE_KEY') as string | undefined;
    const alchemyApiKey = runtime.getSetting('ALCHEMY_API_KEY') as string | undefined;
    const zkevmRpcUrl = runtime.getSetting('ZKEVM_RPC_URL') as string | undefined;

    if (!privateKey) {
      logger.warn('[sendL2TransactionAction] Validation failed: PRIVATE_KEY is not configured.');
      return false;
    }
    if (!alchemyApiKey && !zkevmRpcUrl) {
      logger.warn(
        '[sendL2TransactionAction] Validation failed: Neither ALCHEMY_API_KEY nor ZKEVM_RPC_URL is configured.'
      );
      return false;
    }
    logger.info('[sendL2TransactionAction] Validation passed: Sufficient configuration found.');
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<Content | void> => {
    logger.info('[sendL2TransactionAction] Handler called.');

    const alchemyApiKey = runtime.getSetting('ALCHEMY_API_KEY') as string | undefined;
    const zkevmRpcUrl = runtime.getSetting('ZKEVM_RPC_URL') as string | undefined;
    const privateKey = runtime.getSetting('PRIVATE_KEY') as string | undefined;

    if (!privateKey) {
      logger.error('[sendL2TransactionAction] Critical: PRIVATE_KEY is not configured.');
      const errContent = {
        text: 'Error: PRIVATE_KEY is not configured. Cannot send transaction.',
        actions: [sendL2TransactionAction.name],
      };
      await callback(errContent);
      return errContent;
    }
    if (!alchemyApiKey && !zkevmRpcUrl) {
      logger.error('[sendL2TransactionAction] Critical: RPC endpoint not configured.');
      const errContent = {
        text: 'Error: RPC endpoint not configured. Cannot send transaction.',
        actions: [sendL2TransactionAction.name],
      };
      await callback(errContent);
      return errContent;
    }

    let extractedParams: SendL2TransactionParams | null = null;

    try {
      extractedParams = (await runtime.useModel(ModelType.OBJECT_LARGE, {
        prompt: composePromptFromState({
          state,
          template: extractParamsForSendL2TransactionTemplate,
        }),
      })) as SendL2TransactionParams;

      logger.debug('[sendL2TransactionAction] Parameters from LLM (useModel):', extractedParams);

      const validationResult = extractedParamsSchema.safeParse(extractedParams);

      if (!validationResult.success) {
        const errorMsg = validationResult.error.errors.map((e) => e.message).join(', ');
        throw new Error(`Invalid parameters from LLM: ${errorMsg}`);
      }
      if (validationResult.data.error) {
        throw new Error(`LLM reported an error: ${validationResult.data.error}`);
      }
      extractedParams = validationResult.data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        `[sendL2TransactionAction] Failed to extract or validate parameters: ${errorMessage}`
      );
      const errorContent: Content = {
        text: `Failed to process transaction request: ${errorMessage}`,
        actions: [sendL2TransactionAction.name],
        data: { error: errorMessage },
      };
      await callback(errorContent);
      return errorContent;
    }

    if (!extractedParams) {
      const errText = 'Parameter extraction unexpectedly failed.';
      logger.error(`[sendL2TransactionAction] ${errText}`);
      const errorContent: Content = { text: errText, actions: [sendL2TransactionAction.name] };
      await callback(errorContent);
      return errorContent;
    }

    const { toAddress, value, gasLimit: gasLimitStr, gasPrice: gasPriceStr } = extractedParams;

    try {
      const wallet = new Wallet(privateKey);
      const fromAddress = wallet.address;
      logger.info(`[sendL2TransactionAction] Wallet initialized for address: ${fromAddress}`);

      const providers: { name: string; url: string; provider: JsonRpcProvider }[] = [];
      if (alchemyApiKey) {
        const url = `https://polygonzkevm-mainnet.g.alchemy.com/v2/${alchemyApiKey}`;
        providers.push({
          name: 'Alchemy',
          url,
          provider: new JsonRpcProvider(url, POLYGON_ZKEVM_CHAIN_ID),
        });
      }
      if (zkevmRpcUrl) {
        providers.push({
          name: 'JSON-RPC',
          url: zkevmRpcUrl,
          provider: new JsonRpcProvider(zkevmRpcUrl, POLYGON_ZKEVM_CHAIN_ID),
        });
      }

      if (providers.length === 0) {
        const errText = 'Error: No RPC provider available in handler.';
        logger.error(`[sendL2TransactionAction] ${errText}`);
        const errorContent: Content = { text: errText, actions: [sendL2TransactionAction.name] };
        await callback(errorContent);
        return errorContent;
      }

      logger.info(
        `[sendL2TransactionAction] Attempting to send ${value} ETH from ${fromAddress} to ${toAddress}`
      );

      let txHash: string | undefined;
      let errorMessagesList: string[] = [];

      for (const { name, provider, url } of providers) {
        try {
          logger.info(`[sendL2TransactionAction] Using provider: ${name} (${url})`);
          const feeData = await provider.getFeeData();
          const nonce = await provider.getTransactionCount(fromAddress, 'pending');
          logger.debug(
            `[sendL2TransactionAction] Nonce: ${nonce}, FeeData: ${JSON.stringify(feeData)}`
          );

          const parsedValue = parseEther(value);

          const tx: any = {
            to: toAddress,
            value: parsedValue,
            nonce: nonce,
            chainId: POLYGON_ZKEVM_CHAIN_ID,
            type: 0,
          };

          if (gasPriceStr) {
            tx.gasPrice = parseUnits(gasPriceStr, 'gwei');
          } else {
            tx.gasPrice = feeData.gasPrice;
            if (!tx.gasPrice && feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
              tx.maxFeePerGas = feeData.maxFeePerGas;
              tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
              delete tx.gasPrice;
            } else if (!tx.gasPrice) {
              const defaultGasPrice = parseUnits('10', 'gwei');
              logger.warn(
                `[sendL2TransactionAction] Could not determine gas price from feeData, attempting to use default: ${defaultGasPrice.toString()} Gwei`
              );
              tx.gasPrice = defaultGasPrice;
            }
          }

          if (gasLimitStr) {
            tx.gasLimit = BigInt(gasLimitStr);
          } else {
            const tempTxForEstimate = {
              from: fromAddress,
              to: toAddress,
              value: parsedValue,
            };
            tx.gasLimit = await provider.estimateGas(tempTxForEstimate);
          }
          // Custom stringify for logging to avoid BigInt errors
          const txForLogging = { ...tx };
          for (const key in txForLogging) {
            if (typeof txForLogging[key] === 'bigint') {
              txForLogging[key] = txForLogging[key].toString() + 'n'; // Indicate it was a BigInt
            }
          }
          logger.debug(
            `[sendL2TransactionAction] Transaction object prepared: ${JSON.stringify(txForLogging)}`
          );

          const signedTx = await wallet.signTransaction(tx);
          logger.info('[sendL2TransactionAction] Transaction signed.');

          const broadcastResponse = await provider.broadcastTransaction(signedTx);
          txHash = broadcastResponse.hash;
          logger.info(
            `[sendL2TransactionAction] Transaction broadcasted via ${name}. Hash: ${txHash}`
          );
          break;
        } catch (error) {
          const e = error as Error;
          logger.error(`[sendL2TransactionAction] Error with provider ${name}: ${e.message}`, e);
          errorMessagesList.push(`Failed with ${name}: ${e.message}`);
        }
      }

      if (txHash) {
        const responseText = `Transaction sent successfully!\nHash: ${txHash}\nRecipient: ${toAddress}\nAmount: ${value} ETH`;
        const responseContent: Content = {
          text: responseText,
          actions: [sendL2TransactionAction.name, 'GET_TRANSACTION_RECEIPT'],
          data: {
            transactionHash: txHash,
            toAddress,
            value,
            fromAddress,
            chain: 'polygon-zkevm',
            timestamp: Date.now(),
          },
          source: _message.content.source,
        };
        await callback(responseContent);
        return responseContent;
      } else {
        const combinedError = `Failed to send transaction after trying all providers. Errors: ${errorMessagesList.join('; ')}`;
        logger.error(`[sendL2TransactionAction] ${combinedError}`);
        const errorContent: Content = {
          text: `Error: ${combinedError}`,
          source: _message.content.source,
          actions: [sendL2TransactionAction.name],
        };
        await callback(errorContent);
        return errorContent;
      }
    } catch (error) {
      const e = error as Error;
      logger.error(`[sendL2TransactionAction] Critical unhandled error: ${e.message}`, e);
      const errorContent: Content = {
        text: `Critical error processing transaction: ${e.message}`,
        source: _message.content.source,
        actions: [sendL2TransactionAction.name],
      };
      await callback(errorContent);
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Send 0.5 ETH to 0xRecipientAddress123...',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Transaction sent successfully!\nHash: 0xTxHash123...\nRecipient: 0xRecipientAddress123...\nAmount: 0.5 ETH',
          actions: ['SEND_L2_TRANSACTION', 'GET_TRANSACTION_RECEIPT'],
          data: {
            transactionHash: '0xTxHash123...',
            toAddress: '0xRecipientAddress123...',
            value: '0.5',
            fromAddress: '0xSenderAddress...',
            chain: 'polygon-zkevm',
            timestamp: 1678886400000,
          },
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Transfer 1.2 ETH to 0xAnotherAddress456... with gas limit 30000 and gas price 10 Gwei',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Transaction sent successfully!\nHash: 0xAnotherTxHash456...\nRecipient: 0xAnotherAddress456...\nAmount: 1.2 ETH',
          actions: ['SEND_L2_TRANSACTION', 'GET_TRANSACTION_RECEIPT'],
          data: {
            transactionHash: '0xAnotherTxHash456...',
            toAddress: '0xAnotherAddress456...',
            value: '1.2',
            fromAddress: '0xSenderAddress...',
            chain: 'polygon-zkevm',
            timestamp: 1678886400000,
          },
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'I want to send some eth to my friend',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "LLM reported an error: Missing or invalid required parameters: 'toAddress' and 'value' must be provided and valid.",
          actions: ['SEND_L2_TRANSACTION'],
        },
      },
    ],
  ],
};
