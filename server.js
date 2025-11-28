// Ethers.js Transaction Signing & Sending Backend
// Pure ethers.js implementation for ETH withdrawals

const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BACKEND_URL = 'https://ethers-production.up.railway.app';

// Environment variables
const PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY;
const RPC_URL = process.env.ALCHEMY_RPC || 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY';

// Initialize provider and signer
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

console.log('✅ Backend wallet:', wallet.address);

// WITHDRAWAL ENDPOINT - Pure ethers.js transaction signing
app.post('/withdraw', async (req, res) => {
  try {
    const { toAddress, amountETH } = req.body;
    
    // Validation
    if (!toAddress || !amountETH) {
      return res.status(400).json({ error: 'Missing parameters' });
    }
    
    if (!ethers.isAddress(toAddress)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    
    // Prevent self-transfer
    if (toAddress.toLowerCase() === wallet.address.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot send to backend wallet' });
    }
    
    // Check backend balance
    const balance = await provider.getBalance(wallet.address);
    const balanceETH = ethers.formatEther(balance);
    
    if (parseFloat(balanceETH) < parseFloat(amountETH)) {
      return res.status(400).json({ 
        error: 'Insufficient backend balance',
        balance: balanceETH 
      });
    }
    
    // Get current gas price and nonce
    const feeData = await provider.getFeeData();
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    
    // Build transaction object
    const tx = {
      to: toAddress,
      value: ethers.parseEther(amountETH.toString()),
      nonce: nonce,
      gasLimit: 21000,
      gasPrice: feeData.gasPrice,
      chainId: 1 // Mainnet
    };
    
    console.log('Signing transaction:', {
      from: wallet.address,
      to: toAddress,
      amount: amountETH,
      nonce: nonce,
      gasPrice: ethers.formatUnits(feeData.gasPrice, 'gwei') + ' gwei'
    });
    
    // Sign transaction with ethers.js
    const signedTx = await wallet.signTransaction(tx);
    console.log('Transaction signed:', signedTx.slice(0, 20) + '...');
    
    // Send raw signed transaction
    const txResponse = await provider.broadcastTransaction(signedTx);
    console.log('Transaction broadcast:', txResponse.hash);
    
    // Wait for confirmation
    const receipt = await txResponse.wait(1);
    console.log('Transaction confirmed in block:', receipt.blockNumber);
    
    res.json({
      success: true,
      txHash: txResponse.hash,
      from: wallet.address,
      to: toAddress,
      amount: amountETH,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.gasPrice.toString()
    });
    
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ 
      error: error.message,
      code: error.code 
    });
  }
});

// SIGN MESSAGE ENDPOINT - For verification
app.post('/sign-message', async (req, res) => {
  try {
    const { message } = req.body;
    
    // Sign message with ethers.js
    const signature = await wallet.signMessage(message);
    
    res.json({
      message,
      signature,
      signer: wallet.address
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET TRANSACTION ENDPOINT - Check status
app.get('/transaction/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    
    const tx = await provider.getTransaction(hash);
    const receipt = await provider.getTransactionReceipt(hash);
    
    res.json({
      transaction: tx ? {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: ethers.formatEther(tx.value),
        gasPrice: tx.gasPrice?.toString(),
        nonce: tx.nonce,
        blockNumber: tx.blockNumber
      } : null,
      receipt: receipt ? {
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        confirmations: await receipt.confirmations()
      } : null
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// BALANCE ENDPOINT
app.get('/balance', async (req, res) => {
  try {
    const balance = await provider.getBalance(wallet.address);
    const nonce = await provider.getTransactionCount(wallet.address);
    const feeData = await provider.getFeeData();
    
    res.json({
      address: wallet.address,
      balance: ethers.formatEther(balance),
      nonce: nonce,
      gasPrice: ethers.formatUnits(feeData.gasPrice, 'gwei') + ' gwei'
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ESTIMATE GAS ENDPOINT
app.post('/estimate-gas', async (req, res) => {
  try {
    const { toAddress, amountETH } = req.body;
    
    const gasEstimate = await provider.estimateGas({
      from: wallet.address,
      to: toAddress,
      value: ethers.parseEther(amountETH.toString())
    });
    
    const feeData = await provider.getFeeData();
    const gasCost = gasEstimate * feeData.gasPrice;
    
    res.json({
      gasLimit: gasEstimate.toString(),
      gasPrice: ethers.formatUnits(feeData.gasPrice, 'gwei') + ' gwei',
      totalCost: ethers.formatEther(gasCost) + ' ETH',
      totalCostUSD: (parseFloat(ethers.formatEther(gasCost)) * 3450).toFixed(2)
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EARNINGS CONVERSION ENDPOINTS - Convert site earnings to real ETH
// ═══════════════════════════════════════════════════════════════════════════════

// Track earnings in memory (would use database in production)
let earningsBalance = 0;

// Credit earnings from MEV strategies
app.post('/credit-earnings', async (req, res) => {
  try {
    const { amountUSD, source } = req.body;
    earningsBalance += parseFloat(amountUSD) || 0;
    console.log(`💰 Credited $${amountUSD} from ${source}. Total: $${earningsBalance}`);
    res.json({ success: true, newBalance: earningsBalance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert earnings to ETH and send to treasury (ON-CHAIN TX)
app.post('/convert-earnings-to-eth', async (req, res) => {
  try {
    const { amountETH, amountUSD, treasury, to, toAddress } = req.body;
    const destination = treasury || to || toAddress;
    const ethAmount = parseFloat(amountETH) || (parseFloat(amountUSD) / 3450);
    
    if (!destination) {
      return res.status(400).json({ error: 'Missing destination address' });
    }
    
    // Check backend has enough ETH
    const balance = await provider.getBalance(wallet.address);
    const balanceETH = parseFloat(ethers.formatEther(balance));
    
    if (balanceETH < ethAmount + 0.002) {
      return res.status(400).json({ 
        error: 'Insufficient backend balance for conversion',
        balance: balanceETH,
        required: ethAmount + 0.002
      });
    }
    
    // Build and sign transaction
    const feeData = await provider.getFeeData();
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    
    const tx = {
      to: destination,
      value: ethers.parseEther(ethAmount.toString()),
      nonce: nonce,
      gasLimit: 21000,
      gasPrice: feeData.gasPrice,
      chainId: 1
    };
    
    console.log(`♻️ Converting earnings: ${ethAmount} ETH → ${destination}`);
    
    const signedTx = await wallet.signTransaction(tx);
    const txResponse = await provider.broadcastTransaction(signedTx);
    const receipt = await txResponse.wait(1);
    
    console.log(`✅ Conversion TX confirmed: ${txResponse.hash}`);
    
    res.json({
      success: true,
      txHash: txResponse.hash,
      from: wallet.address,
      to: destination,
      amount: ethAmount,
      amountUSD: ethAmount * 3450,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString()
    });
    
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fund treasury from earnings (alias for convert-earnings-to-eth)
app.post('/fund-from-earnings', async (req, res) => {
  try {
    const { amountETH, amountUSD, treasury, to, toAddress } = req.body;
    const destination = treasury || to || toAddress || wallet.address;
    const ethAmount = parseFloat(amountETH) || (parseFloat(amountUSD) / 3450) || 0.01;
    
    const balance = await provider.getBalance(wallet.address);
    const balanceETH = parseFloat(ethers.formatEther(balance));
    
    if (balanceETH < ethAmount + 0.002) {
      return res.status(400).json({ 
        error: 'Insufficient backend balance',
        balance: balanceETH 
      });
    }
    
    const feeData = await provider.getFeeData();
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    
    const tx = {
      to: destination,
      value: ethers.parseEther(ethAmount.toString()),
      nonce: nonce,
      gasLimit: 21000,
      gasPrice: feeData.gasPrice,
      chainId: 1
    };
    
    const signedTx = await wallet.signTransaction(tx);
    const txResponse = await provider.broadcastTransaction(signedTx);
    const receipt = await txResponse.wait(1);
    
    res.json({
      success: true,
      txHash: txResponse.hash,
      from: wallet.address,
      to: destination,
      amount: ethAmount,
      blockNumber: receipt.blockNumber
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Withdraw profits to treasury (alias)
app.post('/withdraw-profits-to-treasury', async (req, res) => {
  const { treasury, to, toAddress, amountETH, percentage } = req.body;
  const destination = treasury || to || toAddress;
  
  try {
    const balance = await provider.getBalance(wallet.address);
    const balanceETH = parseFloat(ethers.formatEther(balance));
    
    // Calculate amount based on percentage or fixed amount
    let ethAmount = parseFloat(amountETH) || 0.01;
    if (percentage) {
      ethAmount = (balanceETH * parseFloat(percentage) / 100) - 0.002;
    }
    
    if (balanceETH < ethAmount + 0.002) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    const feeData = await provider.getFeeData();
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    
    const tx = {
      to: destination,
      value: ethers.parseEther(ethAmount.toString()),
      nonce: nonce,
      gasLimit: 21000,
      gasPrice: feeData.gasPrice,
      chainId: 1
    };
    
    const signedTx = await wallet.signTransaction(tx);
    const txResponse = await provider.broadcastTransaction(signedTx);
    const receipt = await txResponse.wait(1);
    
    res.json({
      success: true,
      txHash: txResponse.hash,
      amount: ethAmount,
      blockNumber: receipt.blockNumber
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Claim MEV profits (alias)
app.post('/claim-mev-profits', async (req, res) => {
  const { to, toAddress, treasury, amountETH } = req.body;
  const destination = to || toAddress || treasury;
  const ethAmount = parseFloat(amountETH) || 0.01;
  
  try {
    const balance = await provider.getBalance(wallet.address);
    const balanceETH = parseFloat(ethers.formatEther(balance));
    
    if (balanceETH < ethAmount + 0.002) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    const feeData = await provider.getFeeData();
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    
    const tx = {
      to: destination,
      value: ethers.parseEther(ethAmount.toString()),
      nonce: nonce,
      gasLimit: 21000,
      gasPrice: feeData.gasPrice,
      chainId: 1
    };
    
    const signedTx = await wallet.signTransaction(tx);
    const txResponse = await provider.broadcastTransaction(signedTx);
    const receipt = await txResponse.wait(1);
    
    res.json({
      success: true,
      txHash: txResponse.hash,
      amount: ethAmount,
      blockNumber: receipt.blockNumber
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get earnings balance
app.get('/earnings', async (req, res) => {
  const balance = await provider.getBalance(wallet.address);
  res.json({
    earningsUSD: earningsBalance,
    backendBalanceETH: ethers.formatEther(balance),
    backendBalanceUSD: parseFloat(ethers.formatEther(balance)) * 3450
  });
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({ 
    status: 'online',
    wallet: wallet.address,
    endpoints: [
      '/withdraw',
      '/convert-earnings-to-eth',
      '/fund-from-earnings',
      '/withdraw-profits-to-treasury',
      '/claim-mev-profits',
      '/credit-earnings',
      '/earnings',
      '/balance'
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'online',
    wallet: wallet.address,
    ethersVersion: '6.9.0',
    backendUrl: BACKEND_URL
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Ethers.js Backend Online - Port ${PORT}`);
  console.log(`🔑 Wallet: ${wallet.address}`);
});
