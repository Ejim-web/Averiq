// api/lib/ethereum.js
const { ethers } = require('ethers');

// AVQ Token Contract on Sepolia
const AVQ_TOKEN_ADDRESS = "0x586e4A56b8fCA07fa5172D55e8Cdc050A983b6C9";
const AVQ_ABI = [
    {
        "constant": true,
        "inputs": [{ "name": "owner", "type": "address" }],
        "name": "balanceOf",
        "outputs": [{ "name": "", "type": "uint256" }],
        "type": "function"
    },
    {
        "constant": false,
        "inputs": [
            { "name": "to", "type": "address" },
            { "name": "value", "type": "uint256" }
        ],
        "name": "transfer",
        "outputs": [{ "name": "", "type": "bool" }],
        "type": "function"
    }
];

// RPC Providers (with fallback)
const RPC_PROVIDERS = [
    process.env.ETHEREUM_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo",
    "https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
    "https://rpc2.sepolia.org",
    "https://sepolia.gateway.tenderly.co"
];

// Get provider (with fallback)
async function getProvider() {
    for (const rpcUrl of RPC_PROVIDERS) {
        try {
            const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
            await provider.getBlockNumber(); // Test connection
            return provider;
        } catch (error) {
            console.log(`RPC ${rpcUrl} failed, trying next...`);
        }
    }
    throw new Error("All RPC providers failed");
}

// Get AVQ balance
async function getAVQBalance(address) {
    try {
        const provider = await getProvider();
        const contract = new ethers.Contract(AVQ_TOKEN_ADDRESS, AVQ_ABI, provider);
        const balance = await contract.balanceOf(address);
        return ethers.utils.formatUnits(balance, 18);
    } catch (error) {
        console.error("Error getting AVQ balance:", error);
        return "0";
    }
}

// Transfer AVQ tokens
async function transferAVQ(fromWallet, toAddress, amount) {
    try {
        const provider = await getProvider();
        const wallet = new ethers.Wallet(fromWallet.privateKey, provider);
        const contract = new ethers.Contract(AVQ_TOKEN_ADDRESS, AVQ_ABI, wallet);
        
        const tx = await contract.transfer(toAddress, ethers.utils.parseUnits(amount.toString(), 18));
        await tx.wait();
        
        return { success: true, txHash: tx.hash };
    } catch (error) {
        console.error("Transfer error:", error);
        return { success: false, error: error.message };
    }
}

// Get network info
async function getNetworkInfo() {
    try {
        const provider = await getProvider();
        const network = await provider.getNetwork();
        const blockNumber = await provider.getBlockNumber();
        const gasPrice = await provider.getGasPrice();
        
        return {
            network: network.name,
            chainId: network.chainId,
            blockNumber,
            gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei')
        };
    } catch (error) {
        console.error("Network info error:", error);
        return null;
    }
}

module.exports = {
    getAVQBalance,
    transferAVQ,
    getNetworkInfo,
    AVQ_TOKEN_ADDRESS
};
