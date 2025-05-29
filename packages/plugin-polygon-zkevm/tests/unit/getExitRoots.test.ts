import { getExitRootsAction } from '../../src/actions/getExitRoots';
import { type IAgentRuntime, type Memory, type State, type Content, logger } from '@elizaos/core';

// Mock the logger to prevent console output during tests
jest.mock('@elizaos/core', () => ({
  ...jest.requireActual('@elizaos/core'),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock 'ethers' JsonRpcProvider
const mockSend = jest.fn();
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
}));

// Mock global fetch
global.fetch = jest.fn();

const mockRuntime = {
  getSetting: jest.fn(),
  useModel: jest.fn(),
  getService: jest.fn(),
  getServices: jest.fn(),
  getPlugin: jest.fn(),
  getPlugins: jest.fn(),
  getProvider: jest.fn(),
  getProviders: jest.fn(),
} as unknown as IAgentRuntime;

const mockMemory = {} as Memory;
const mockState = {} as State;
const mockCallback = jest.fn() as jest.MockedFunction<(content: Content) => Promise<void>>;

const validL1Root = '0x' + '1'.repeat(64);
const validL2Root = '0x' + '2'.repeat(64);

describe('getExitRootsAction', () => {
  beforeEach(() => {
    jest.clearAllMocks(); // Clear all mocks before each test
    (fetch as jest.Mock).mockClear();
    mockSend.mockClear();
    mockCallback.mockClear();
    (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
      if (key === 'ALCHEMY_API_KEY') return 'test-alchemy-key';
      if (key === 'ZKEVM_RPC_URL') return 'http://test-rpc-url.com';
      return undefined;
    });
  });

  it('should return L1 and L2 roots using Alchemy if API key is provided', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          mainnetExitRoot: validL1Root,
          rollupExitRoot: validL2Root,
        },
      }),
    });

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

    expect(fetch).toHaveBeenCalledWith(
      'https://polygonzkevm-mainnet.g.alchemy.com/v2/test-alchemy-key',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'zkevm_getBatchByNumber',
          params: ['latest', false],
        }),
      })
    );
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: `Current Exit Roots:\nL1 Root (Mainnet): ${validL1Root}\nL2 Root (Rollup): ${validL2Root}`,
        data: {
          l1Root: validL1Root,
          l2Root: validL2Root,
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
    mockSend.mockResolvedValueOnce({
      mainnetExitRoot: validL1Root,
      rollupExitRoot: validL2Root,
    });

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

    expect(fetch).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith('zkevm_getBatchByNumber', ['latest', false]);
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: `Current Exit Roots:\nL1 Root (Mainnet): ${validL1Root}\nL2 Root (Rollup): ${validL2Root}`,
        data: {
          l1Root: validL1Root,
          l2Root: validL2Root,
        },
      })
    );
  });

  it('should fallback to ZKEVM_RPC_URL if Alchemy fetch fails', async () => {
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('Alchemy down'));
    mockSend.mockResolvedValueOnce({
      mainnetExitRoot: validL1Root,
      rollupExitRoot: validL2Root,
    });

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('zkevm_getBatchByNumber', ['latest', false]);
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: `Current Exit Roots:\nL1 Root (Mainnet): ${validL1Root}\nL2 Root (Rollup): ${validL2Root}`,
        data: {
          l1Root: validL1Root,
          l2Root: validL2Root,
        },
      })
    );
  });

  it('should return an error if neither ALCHEMY_API_KEY nor ZKEVM_RPC_URL is configured', async () => {
    (mockRuntime.getSetting as jest.Mock).mockReturnValue(undefined);

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

    expect(fetch).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Error: Neither ALCHEMY_API_KEY nor ZKEVM_RPC_URL is configured.',
      })
    );
  });

  it('should return an error if Alchemy response is not ok', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      statusText: 'Gateway Timeout',
    });
    mockSend.mockResolvedValueOnce({
      // Provide a valid fallback
      mainnetExitRoot: validL1Root,
      rollupExitRoot: validL2Root,
    });

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);
    // It should try Alchemy, fail, then try RPC
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: `Current Exit Roots:\nL1 Root (Mainnet): ${validL1Root}\nL2 Root (Rollup): ${validL2Root}`,
      })
    );
  });

  it('should return an error if Alchemy response structure is invalid', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: {} }), // Missing roots
    });
    mockSend.mockResolvedValueOnce({
      // Provide a valid fallback
      mainnetExitRoot: validL1Root,
      rollupExitRoot: validL2Root,
    });

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);
    // It should try Alchemy, fail due to structure, then try RPC
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: `Current Exit Roots:\nL1 Root (Mainnet): ${validL1Root}\nL2 Root (Rollup): ${validL2Root}`,
      })
    );
  });

  it('should return an error if RPC call fails', async () => {
    (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
      if (key === 'ALCHEMY_API_KEY') return undefined; // Force RPC
      if (key === 'ZKEVM_RPC_URL') return 'http://test-rpc-url.com';
      return undefined;
    });
    mockSend.mockRejectedValueOnce(new Error('RPC down'));

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Error: Failed to fetch exit roots after trying all providers. Errors: Failed with JSON-RPC: RPC down',
      })
    );
  });

  it('should return an error if L1 root from Alchemy is invalid', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          mainnetExitRoot: 'invalid-root',
          rollupExitRoot: validL2Root,
        },
      }),
    });
    // Fallback should be called
    mockSend.mockResolvedValueOnce({
      mainnetExitRoot: validL1Root,
      rollupExitRoot: validL2Root,
    });

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid L1 root from Alchemy')
    );
    expect(mockSend).toHaveBeenCalledTimes(1); // Fallback was attempted
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          l1Root: validL1Root, // from fallback
          l2Root: validL2Root,
        },
      })
    );
  });

  it('should return an error if L2 root from RPC is invalid', async () => {
    (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
      if (key === 'ALCHEMY_API_KEY') return undefined; // Force RPC
      if (key === 'ZKEVM_RPC_URL') return 'http://test-rpc-url.com';
      return undefined;
    });
    mockSend.mockResolvedValueOnce({
      mainnetExitRoot: validL1Root,
      rollupExitRoot: 'invalid-root',
    });

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid L2 root from JSON-RPC')
    );
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Error: Failed to fetch exit roots after trying all providers. Errors: Failed with JSON-RPC: Invalid L2 root format from JSON-RPC: invalid-root',
      })
    );
  });

  it('should handle case where only ALCHEMY_API_KEY is provided and it fails, with no ZKEVM_RPC_URL fallback', async () => {
    (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
      if (key === 'ALCHEMY_API_KEY') return 'test-alchemy-key';
      if (key === 'ZKEVM_RPC_URL') return undefined; // No fallback RPC
      return undefined;
    });
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('Alchemy fetch failed'));

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Error: Failed to fetch exit roots after trying all providers. Errors: Failed with Alchemy: Alchemy fetch failed',
      })
    );
  });

  it('should handle case where only ZKEVM_RPC_URL is provided and it fails, with no ALCHEMY_API_KEY', async () => {
    (mockRuntime.getSetting as jest.Mock).mockImplementation((key: string) => {
      if (key === 'ALCHEMY_API_KEY') return undefined; // No Alchemy
      if (key === 'ZKEVM_RPC_URL') return 'http://test-rpc-url.com';
      return undefined;
    });
    mockSend.mockRejectedValueOnce(new Error('RPC call failed'));

    await getExitRootsAction.handler(mockRuntime, mockMemory, mockState, {}, mockCallback, []);

    expect(fetch).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Error: Failed to fetch exit roots after trying all providers. Errors: Failed with JSON-RPC: RPC call failed',
      })
    );
  });
});
