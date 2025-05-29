import { estimateZkNonceAction } from '../../src/actions/estimateZkNonce';
import {
  type IAgentRuntime,
  type Memory,
  type State,
  type Content,
  logger,
  ModelType,
  composePromptFromState,
} from '@elizaos/core';
import { extractAddressForZkNonceTemplate } from '../../src/templates';

// Mock the logger
jest.mock('@elizaos/core', () => ({
  ...jest.requireActual('@elizaos/core'),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  composePromptFromState: jest.fn(), // Mock this as well
}));

// Mock 'ethers' JsonRpcProvider
const mockSend = jest.fn();
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  isAddress: jest.fn((addr) => /^0x[a-fA-F0-9]{40}$/.test(addr)), // Simple mock for isAddress
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

const testAddress = '0x1234567890123456789012345678901234567890';
const testNonceHex = '0xa'; // 10 in decimal
const testNonceDecimal = '10';

describe('estimateZkNonceAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetch as jest.Mock).mockClear();
    mockSend.mockClear();
    mockCallback.mockClear();
    (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
      if (key === 'ALCHEMY_API_KEY') return 'test-alchemy-key';
      if (key === 'ZKEVM_RPC_URL') return 'http://test-rpc-url.com';
      return undefined;
    });
    (mockRuntime.useModel as jest.Mock).mockResolvedValue({ address: testAddress });
    (composePromptFromState as jest.Mock).mockReturnValue('mocked-prompt');
  });

  describe('handler', () => {
    it('should return nonce using Alchemy if API key is provided', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: testNonceHex }),
      });

      await estimateZkNonceAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

      expect(mockRuntime.useModel).toHaveBeenCalledWith(ModelType.OBJECT_LARGE, {
        prompt: 'mocked-prompt',
      });
      expect(composePromptFromState).toHaveBeenCalledWith({
        state: mockState,
        template: extractAddressForZkNonceTemplate,
      });
      expect(fetch).toHaveBeenCalledWith(
        'https://polygonzkevm-mainnet.g.alchemy.com/v2/test-alchemy-key',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionCount',
            params: [testAddress, 'pending'],
          }),
        })
      );
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: `The next zk-nonce (zkCounter) for address ${testAddress} is: ${testNonceDecimal}`,
          data: {
            address: testAddress,
            zkNonce: testNonceDecimal,
          },
        })
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should fallback to ZKEVM_RPC_URL if Alchemy API key is not provided', async () => {
      (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ALCHEMY_API_KEY') return undefined;
        if (key === 'ZKEVM_RPC_URL') return 'http://test-rpc-url.com';
        return undefined;
      });
      mockSend.mockResolvedValueOnce(testNonceHex);

      await estimateZkNonceAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

      expect(fetch).not.toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledWith('eth_getTransactionCount', [testAddress, 'pending']);
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: `The next zk-nonce (zkCounter) for address ${testAddress} is: ${testNonceDecimal}`,
        })
      );
    });

    it('should fallback to ZKEVM_RPC_URL if Alchemy fetch fails', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Alchemy down'));
      mockSend.mockResolvedValueOnce(testNonceHex);

      await estimateZkNonceAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: `The next zk-nonce (zkCounter) for address ${testAddress} is: ${testNonceDecimal}`,
        })
      );
    });

    it('should return error if address extraction fails', async () => {
      (mockRuntime.useModel as jest.Mock).mockResolvedValueOnce({
        error: 'Failed to extract address',
      });

      await estimateZkNonceAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Failed to process zkNonce request: LLM reported an error: Failed to extract address',
        })
      );
    });

    it('should return error if extracted address is invalid', async () => {
      (mockRuntime.useModel as jest.Mock).mockResolvedValueOnce({ address: 'invalid-address' });

      await estimateZkNonceAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Failed to process zkNonce request: Invalid parameters from LLM: Invalid address format.',
        })
      );
    });

    it('should return error if RPC call fails after Alchemy fails', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Alchemy down'));
      mockSend.mockRejectedValueOnce(new Error('RPC down'));

      await estimateZkNonceAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Error: Failed to fetch nonce after trying all providers. Errors: Failed with Alchemy: Alchemy down; Failed with JSON-RPC: RPC down',
        })
      );
    });

    it('should handle error if only Alchemy configured and it fails', async () => {
      (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ALCHEMY_API_KEY') return 'test-alchemy-key';
        if (key === 'ZKEVM_RPC_URL') return undefined;
        return undefined;
      });
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Alchemy error'));

      await estimateZkNonceAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Error: Failed to fetch nonce after trying all providers. Errors: Failed with Alchemy: Alchemy error',
        })
      );
    });

    it('should handle error if only RPC configured and it fails', async () => {
      (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ALCHEMY_API_KEY') return undefined;
        if (key === 'ZKEVM_RPC_URL') return 'http://test-rpc-url.com';
        return undefined;
      });
      mockSend.mockRejectedValueOnce(new Error('RPC error'));

      await estimateZkNonceAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Error: Failed to fetch nonce after trying all providers. Errors: Failed with JSON-RPC: RPC error',
        })
      );
    });
  });

  describe('validate', () => {
    it('should return true if ALCHEMY_API_KEY is configured', async () => {
      (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ALCHEMY_API_KEY') return 'test-key';
        return undefined;
      });
      const isValid = await estimateZkNonceAction.validate?.(mockRuntime, mockMemory, mockState);
      expect(isValid).toBe(true);
    });

    it('should return true if ZKEVM_RPC_URL is configured', async () => {
      (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ZKEVM_RPC_URL') return 'http://test-url.com';
        return undefined;
      });
      const isValid = await estimateZkNonceAction.validate?.(mockRuntime, mockMemory, mockState);
      expect(isValid).toBe(true);
    });

    it('should return false if neither ALCHEMY_API_KEY nor ZKEVM_RPC_URL is configured', async () => {
      (mockRuntime.getSetting as jest.Mock).mockReturnValue(undefined);
      const isValid = await estimateZkNonceAction.validate?.(mockRuntime, mockMemory, mockState);
      expect(isValid).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        '[estimateZkNonceAction] Validation failed: Neither ALCHEMY_API_KEY nor ZKEVM_RPC_URL is configured.'
      );
    });
  });
});
