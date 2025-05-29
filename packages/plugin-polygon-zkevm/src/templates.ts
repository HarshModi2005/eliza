export const blockDetailsByNumberTemplate = `You are an AI assistant. Your task is to extract the block number from the user's message.
The block number must be a positive integer.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the block number.

Respond with a JSON markdown block containing only the extracted block number.
The JSON should have this structure:
\`\`\`json
{
    "blockNumber": number
}
\`\`\`

If no valid block number is found, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Block number not found or invalid. Please specify a positive integer for the block number."
}
\`\`\`
`;

export const blockDetailsByHashTemplate = `You are an AI assistant. Your task is to extract the block hash from the user's message.
The block hash must be a valid hexadecimal string starting with '0x'.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the block hash.

Respond with a JSON markdown block containing only the extracted block hash.
The JSON should have this structure:
\`\`\`json
{
    "blockHash": string
}
\`\`\`

If no valid block hash is found, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Block hash not found or invalid. Please specify a valid hexadecimal block hash starting with '0x'."
}
\`\`\`
`;

export const extractAddressForZkNonceTemplate = `You are an AI assistant. Your task is to extract the Ethereum address from the user's message for estimating the zkNonce/zkCounter.
The address must be a valid 42-character hexadecimal string starting with '0x'.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the Ethereum address for which the zkNonce is requested.

Respond with a JSON markdown block containing only the extracted address.
The JSON should have this structure:
\`\`\`json
{
    "address": "0x..."
}
\`\`\`

If no valid Ethereum address is found specifically for a zkNonce/zkCounter request, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Ethereum address not found or invalid. Please specify a valid 42-character hexadecimal address starting with '0x' for zkNonce estimation."
}
\`\`\`
`;

export const extractParamsForSendL2TransactionTemplate = `You are an AI assistant. Your task is to extract parameters from the user's message to send a native ETH transaction on Polygon zkEVM.

The user must specify the recipient address ('toAddress') and the amount of ETH to send ('value').
Optionally, the user can specify 'gasLimit' and 'gasPrice'.

- 'toAddress' must be a valid 42-character Ethereum hexadecimal address starting with '0x'.
- 'value' should be a string representing the amount of ETH, e.g., "0.1", "1.5".
- 'gasLimit' (optional) should be a string representing a number, e.g., "21000".
- 'gasPrice' (optional) should be a string representing the price in Gwei, e.g., "5", "10.5".

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the parameters for the transaction.

Respond with a JSON markdown block containing the extracted parameters.
The JSON should have this structure:
\`\`\`json
{
    "toAddress": "0x...",
    "value": "0.1", // ETH
    "gasLimit": "21000", // Optional
    "gasPrice": "5" // Optional, in Gwei
}
\`\`\`

If 'toAddress' or 'value' cannot be clearly identified, or if 'toAddress' is invalid, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Missing or invalid required parameters: 'toAddress' and 'value' must be provided and valid."
}
\`\`\`

If optional parameters are provided but seem malformed (e.g., non-numeric gasLimit), you can omit them or return an error if critical. For this task, try to extract what's valid and omit invalid optional ones.
The 'from' address is handled by the system using a preconfigured private key. Do not ask for or try to extract a 'from' address.
Example: User says "Send 0.05 ETH to 0x123abc..."
Response:
\`\`\`json
{
    "toAddress": "0x123abc...",
    "value": "0.05"
}
\`\`\`
Example: User says "Transfer 1 ETH to 0xdef456... with gas limit 25000 and gas price 10 Gwei"
Response:
\`\`\`json
{
    "toAddress": "0xdef456...",
    "value": "1",
    "gasLimit": "25000",
    "gasPrice": "10"
}
\`\`\`
`;
