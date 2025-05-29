import { sendL2TransactionAction } from '../../src/actions/sendL2Transaction';
import {
  type IAgentRuntime,
  type Memory,
  type State,
  type Content,
  logger,
  ModelType,
  composePromptFromState,
} from '@elizaos/core';
import { extractParamsForSendL2TransactionTemplate } from '../../src/templates';
import { JsonRpcProvider, Wallet, parseEther, parseUnits, FeeData } from 'ethers';

// Mock core and logger
jest.mock('@elizaos/core', () => ({
  ...jest.requireActual('@elizaos/core'),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  composePromptFromState: jest.fn(),
}));

// Mock ethers
const mockGetTransactionCount = jest.fn();
const mockGetFeeData = jest.fn();
const mockEstimateGas = jest.fn();
const mockSignTransaction = jest.fn();
const mockBroadcastTransaction = jest.fn();
const mockSend = jest.fn(); // For generic RPC provider

jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getTransactionCount: mockGetTransactionCount,
    getFeeData: mockGetFeeData,
    estimateGas: mockEstimateGas,
    broadcastTransaction: mockBroadcastTransaction,
    send: mockSend, // for direct calls if any, or for the generic provider instance
  })),
  Wallet: jest.fn().mockImplementation((privateKey) => ({
    address: '0xMockFromAddress',
    privateKey,
    signTransaction: mockSignTransaction,
    // Mock connect if you create a new Wallet instance with a provider
    connect: jest.fn().mockReturnThis(),
  })),
  isAddress: jest.fn((addr) => /^0x[a-fA-F0-9]{40}$/.test(addr)),
  parseEther: jest.fn((val) => BigInt(parseFloat(val) * 1e18)),
  parseUnits: jest.fn((val, unit) => {
    if (unit === 'gwei') return BigInt(parseFloat(val) * 1e9);
    return BigInt(val);
  }),
}));

// Mock global fetch
global.fetch = jest.fn();

const mockRuntime = {
  getSetting: jest.fn(),
  useModel: jest.fn(),
} as unknown as IAgentRuntime;

const mockMemory = {
  content: { source: 'test-source' },
} as Memory;
const mockState = {} as State;
const mockCallback = jest.fn() as jest.MockedFunction<(content: Content) => Promise<void>>;

const testToAddress = '0x1234567890123456789012345678901234567890';
const testValue = '0.1';
const testPrivateKey = '0x' + 'a'.repeat(64);
const testTxHash = '0x' + 't'.repeat(64);

describe('sendL2TransactionAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetch as jest.Mock).mockClear();
    mockSend.mockClear();
    mockCallback.mockClear();
    (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
      if (key === 'ALCHEMY_API_KEY') return 'test-alchemy-key';
      if (key === 'ZKEVM_RPC_URL') return 'http://test-rpc-url.com';
      if (key === 'PRIVATE_KEY') return testPrivateKey;
      return undefined;
    });
    (composePromptFromState as jest.Mock).mockReturnValue('mocked-prompt-sendtx');
    (mockRuntime.useModel as jest.Mock).mockResolvedValue({
      toAddress: testToAddress,
      value: testValue,
    });

    // Reset ethers mocks specific to provider calls
    mockGetTransactionCount.mockResolvedValue(10); // Default nonce
    mockGetFeeData.mockResolvedValue(
      new FeeData(BigInt(10e9)) // 10 Gwei gasPrice
    );
    mockEstimateGas.mockResolvedValue(BigInt(21000)); // Default gas limit
    mockSignTransaction.mockResolvedValue('signed-tx-payload');
    mockBroadcastTransaction.mockResolvedValue({ hash: testTxHash });
    mockSend.mockResolvedValue({ hash: testTxHash }); // For generic provider broadcasting

    // Mock Alchemy fetch behavior
    (fetch as jest.Mock).mockImplementation(async (url, options) => {
      if (typeof options?.body !== 'string') throw new Error('Fetch body not stringified');
      const body = JSON.parse(options.body);
      if (body.method === 'eth_getTransactionCount') {
        return { ok: true, json: async () => ({ result: '0xa' }) }; // 10
      }
      if (body.method === 'eth_feeData' || body.method === 'eth_gasPrice') {
        // Alchemy might use eth_gasPrice or internal fee data logic
        return { ok: true, json: async () => ({ result: { gasPrice: '0x2540be400' } }) }; // 10 Gwei
      }
      if (body.method === 'eth_estimateGas') {
        return { ok: true, json: async () => ({ result: '0x5208' }) }; // 21000
      }
      if (body.method === 'eth_sendRawTransaction') {
        return { ok: true, json: async () => ({ result: testTxHash }) };
      }
      return { ok: false, statusText: 'Unhandled mock fetch' };
    });
  });

  describe('handler', () => {
    it('should send transaction via Alchemy with extracted params', async () => {
      await sendL2TransactionAction.handler(
        mockRuntime,
        mockMemory,
        mockState,
        {},
        mockCallback,
        []
      );

      expect(mockRuntime.useModel).toHaveBeenCalledWith(ModelType.OBJECT_LARGE, {
        prompt: 'mocked-prompt-sendtx',
      });
      expect(Wallet).toHaveBeenCalledWith(testPrivateKey);
      // Verify provider interactions (assuming Alchemy is the first provider)
      expect(mockGetTransactionCount).toHaveBeenCalledWith('0xMockFromAddress', 'pending');
      expect(mockGetFeeData).toHaveBeenCalled();
      expect(mockEstimateGas).toHaveBeenCalled();
      expect(mockSignTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          to: testToAddress,
          value: parseEther(testValue),
          nonce: 10,
          type: 0,
          gasLimit: BigInt(21000),
          gasPrice: BigInt(10e9),
        })
      );
      expect(mockBroadcastTransaction).toHaveBeenCalledWith('signed-tx-payload');
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(`Transaction sent successfully!\nHash: ${testTxHash}`),
          data: expect.objectContaining({ transactionHash: testTxHash }),
        })
      );
    });

    it('should use user-provided gasLimit and gasPrice via Alchemy', async () => {
      const userGasLimit = '30000';
      const userGasPrice = '15'; // Gwei
      (mockRuntime.useModel as jest.Mock).mockResolvedValue({
        toAddress: testToAddress,
        value: testValue,
        gasLimit: userGasLimit,
        gasPrice: userGasPrice,
      });
      mockEstimateGas.mockClear(); // Should not be called

      await sendL2TransactionAction.handler(
        mockRuntime,
        mockMemory,
        mockState,
        {},
        mockCallback,
        []
      );

      expect(mockEstimateGas).not.toHaveBeenCalled();
      expect(mockSignTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          gasLimit: BigInt(userGasLimit),
          gasPrice: parseUnits(userGasPrice, 'gwei'),
        })
      );
      expect(mockBroadcastTransaction).toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining(testTxHash) })
      );
    });

    it('should fallback to JSON-RPC if Alchemy is not configured', async () => {
      (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ALCHEMY_API_KEY') return undefined;
        if (key === 'ZKEVM_RPC_URL') return 'http://test-rpc-url.com';
        if (key === 'PRIVATE_KEY') return testPrivateKey;
        return undefined;
      });
      // Reset specific JsonRpcProvider mocks for this test
      mockGetTransactionCount.mockResolvedValueOnce(12);
      mockGetFeeData.mockResolvedValueOnce(new FeeData(BigInt(12e9)));
      mockEstimateGas.mockResolvedValueOnce(BigInt(22000));
      mockBroadcastTransaction.mockResolvedValueOnce({ hash: '0xrpcHash' });

      await sendL2TransactionAction.handler(
        mockRuntime,
        mockMemory,
        mockState,
        {},
        mockCallback,
        []
      );

      expect(JsonRpcProvider).toHaveBeenCalledWith('http://test-rpc-url.com', 1101n);
      expect(mockGetTransactionCount).toHaveBeenCalledWith('0xMockFromAddress', 'pending');
      expect(mockGetFeeData).toHaveBeenCalled();
      expect(mockEstimateGas).toHaveBeenCalled();
      expect(mockSignTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ nonce: 12, gasPrice: BigInt(12e9) })
      );
      expect(mockBroadcastTransaction).toHaveBeenCalledWith('signed-tx-payload');
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('0xrpcHash') })
      );
    });

    it('should fallback to JSON-RPC if Alchemy call fails', async () => {
      // First provider (Alchemy) will use its JsonRpcProvider instance which has mocks set up.
      // Let's make broadcastTransaction fail for the first provider (Alchemy)
      mockBroadcastTransaction.mockRejectedValueOnce(new Error('Alchemy broadcast error'));
      // Setup the second provider (RPC) to succeed
      const rpcProviderInstance = {
        getTransactionCount: jest.fn().mockResolvedValue(15),
        getFeeData: jest.fn().mockResolvedValue(new FeeData(BigInt(15e9))),
        estimateGas: jest.fn().mockResolvedValue(BigInt(25000)),
        broadcastTransaction: jest.fn().mockResolvedValue({ hash: '0xrpcFallbackHash' }),
      };
      const originalJsonRpcProvider = jest.requireActual('ethers').JsonRpcProvider;
      (JsonRpcProvider as jest.Mock)
        .mockImplementationOnce(() => ({
          // For Alchemy (will fail broadcast)
          getTransactionCount: mockGetTransactionCount,
          getFeeData: mockGetFeeData,
          estimateGas: mockEstimateGas,
          broadcastTransaction: mockBroadcastTransaction, // This is the one that fails
        }))
        .mockImplementationOnce(() => rpcProviderInstance); // For generic RPC (will succeed)

      await sendL2TransactionAction.handler(
        mockRuntime,
        mockMemory,
        mockState,
        {},
        mockCallback,
        []
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error with provider Alchemy'),
        expect.any(Error)
      );
      expect(rpcProviderInstance.broadcastTransaction).toHaveBeenCalledWith('signed-tx-payload');
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('0xrpcFallbackHash') })
      );
    });

    it('should return error if LLM parameter extraction fails (e.g. missing toAddress)', async () => {
      (mockRuntime.useModel as jest.Mock).mockResolvedValue({
        value: testValue /* missing toAddress */,
      });
      await sendL2TransactionAction.handler(
        mockRuntime,
        mockMemory,
        mockState,
        {},
        mockCallback,
        []
      );
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Invalid parameters from LLM: Invalid toAddress format.'),
        })
      );
    });

    it('should return error if LLM reports an error', async () => {
      const llmError = 'LLM could not determine parameters.';
      (mockRuntime.useModel as jest.Mock).mockResolvedValue({ error: llmError });
      await sendL2TransactionAction.handler(
        mockRuntime,
        mockMemory,
        mockState,
        {},
        mockCallback,
        []
      );
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: `Failed to process transaction request: LLM reported an error: ${llmError}`,
        })
      );
    });

    it('should return error if all providers fail', async () => {
      mockBroadcastTransaction.mockRejectedValue(new Error('Provider error')); // Both Alchemy and RPC will use this mock and fail
      (JsonRpcProvider as jest.Mock).mockImplementation(() => ({
        getTransactionCount: mockGetTransactionCount,
        getFeeData: mockGetFeeData,
        estimateGas: mockEstimateGas,
        broadcastTransaction: mockBroadcastTransaction, // This will be rejected for both
      }));

      await sendL2TransactionAction.handler(
        mockRuntime,
        mockMemory,
        mockState,
        {},
        mockCallback,
        []
      );
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(
            'Failed to send transaction after trying all providers. Errors: Failed with Alchemy: Provider error; Failed with JSON-RPC: Provider error'
          ),
        })
      );
    });

    it('should use default gas price if feeData.gasPrice is null and EIP-1559 fields are also null', async () => {
      mockGetFeeData.mockResolvedValue(new FeeData(null, null, null)); // All null
      await sendL2TransactionAction.handler(
        mockRuntime,
        mockMemory,
        mockState,
        {},
        mockCallback,
        []
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Could not determine gas price from feeData, attempting to use default:'
        )
      );
      expect(mockSignTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          gasPrice: parseUnits('10', 'gwei'), // Default 10 Gwei
        })
      );
    });
  });

  describe('validate', () => {
    it('should return false if PRIVATE_KEY is not configured', async () => {
      (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === 'PRIVATE_KEY') return undefined;
        return 'something'; // Other keys are present
      });
      const isValid = await sendL2TransactionAction.validate?.(mockRuntime, mockMemory, mockState);
      expect(isValid).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('PRIVATE_KEY is not configured')
      );
    });

    it('should return false if neither ALCHEMY_API_KEY nor ZKEVM_RPC_URL is configured', async () => {
      (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === 'PRIVATE_KEY') return testPrivateKey;
        if (key === 'ALCHEMY_API_KEY') return undefined;
        if (key === 'ZKEVM_RPC_URL') return undefined;
        return undefined;
      });
      const isValid = await sendL2TransactionAction.validate?.(mockRuntime, mockMemory, mockState);
      expect(isValid).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Neither ALCHEMY_API_KEY nor ZKEVM_RPC_URL is configured')
      );
    });

    it('should return true if PRIVATE_KEY and ALCHEMY_API_KEY are configured', async () => {
      (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === 'PRIVATE_KEY') return testPrivateKey;
        if (key === 'ALCHEMY_API_KEY') return 'test-key';
        return undefined;
      });
      const isValid = await sendL2TransactionAction.validate?.(mockRuntime, mockMemory, mockState);
      expect(isValid).toBe(true);
    });

    it('should return true if PRIVATE_KEY and ZKEVM_RPC_URL are configured', async () => {
      (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === 'PRIVATE_KEY') return testPrivateKey;
        if (key === 'ZKEVM_RPC_URL') return 'http://test-url.com';
        return undefined;
      });
      const isValid = await sendL2TransactionAction.validate?.(mockRuntime, mockMemory, mockState);
      expect(isValid).toBe(true);
    });
  });
});
