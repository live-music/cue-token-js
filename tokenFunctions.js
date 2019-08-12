const {
  Client, NonceTxMiddleware, SignedTxMiddleware, Address,
  LocalAddress, CryptoUtils, LoomProvider, Contracts
} = require('loom-js');
const Web3 = require('web3');
const BN = require('bn.js');
const { OfflineWeb3Signer } = require('loom-js/dist/solidity-helpers');
const CUEToken = require('./abi/CUEToken.json');
const CUETokenLoom = require('./abi/CUETokenLoom.json');
const Gateway = require('./Gateway.json');

const TransferGateway = Contracts.TransferGateway;
const AddressMapper = Contracts.AddressMapper;

const mainnetGatewayAddress = '0xb73C9506cb7f4139A4D6Ac81DF1e5b6756Fab7A2'; // rinkeby
const loomGatewayAddress = '0xE754d9518bF4a9C63476891eF9Aa7D91c8236a5d'; // extdev
const coinMultiplier = new BN(10).pow(new BN(18));

function loadMainnetAccount(environment, privateKey) {
  const endpoint = environment === 'mainnet' ? 'mainnet' : 'rinkeby';
  const web3 = new Web3(`https://${ endpoint }.infura.io/v3/4528acb6d57d4bbb8fd0caa204e66464`);
  const ownerAccount = web3.eth.accounts.privateKeyToAccount(`0x${ privateKey }`);
  web3.eth.accounts.wallet.add(ownerAccount);
  return { account: ownerAccount, web3 };
}

function loadLoomAccount(environment, privateKey) {
  const publicKey = CryptoUtils.publicKeyFromPrivateKey(privateKey);
  const client = new Client(
    environment === 'mainnet' ? 'loomv2b' : 'extdev-plasma-us1',
    'ws://extdev-plasma-us1.dappchains.com/websocket',
    'ws://extdev-plasma-us1.dappchains.com/queryws'
  );

  client.txMiddleware = [
    new NonceTxMiddleware(publicKey, client),
    new SignedTxMiddleware(privateKey)
  ];

  client.on('error', msg => {
    console.error('PlasmaChain connection error', msg);
  });

  return {
    account: LocalAddress.fromPublicKey(publicKey).toString(),
    web3: new Web3(new LoomProvider(client, privateKey)),
    client
  };
}

async function getLoomCoinContract(web3) {
  const networkId = await web3.eth.net.getId();
  return new web3.eth.Contract(
    CUETokenLoom.abi,
    CUETokenLoom.networks[networkId].address,
  );
}

async function getMainnetCoinContract(web3js) {
  const networkId = await web3js.eth.net.getId();
  return new web3js.eth.Contract(
    CUEToken.abi,
    CUEToken.networks[networkId].address
  );
}

async function getMainnetCoinContractAddress(web3js) {
  const networkId = await web3js.eth.net.getId();
  return CUEToken.networks[networkId].address;
}

async function getMainnetGatewayContract(web3) {
  const networkId = await web3.eth.net.getId();
  return new web3.eth.Contract(
    Gateway.abi,
    Gateway.networks[networkId].address
  );
}

async function depositCoinToLoomGateway({
  client, web3, amount,
  ownerLoomAddress, ownerMainnetAddress,
  tokenLoomAddress, tokenMainnetAddress, timeout
}) {
  const ownerLoomAddr = Address.fromString(`${ client.chainId }:${ ownerLoomAddress }`);
  const gatewayContract = await TransferGateway.createAsync(client, ownerLoomAddr);

  const coinContract = await getLoomCoinContract(web3);
  await coinContract.methods
    .approve(loomGatewayAddress.toLowerCase(), amount.toString())
    .send({ from: ownerLoomAddress });

  const ownerMainnetAddr = Address.fromString(`eth:${ ownerMainnetAddress }`);
  const receiveSignedWithdrawalEvent = new Promise((resolve, reject) => {
    let timer = setTimeout(
      () => reject(new Error('Timeout while waiting for withdrawal to be signed')),
      timeout
    );
    const listener = event => {
      const tokenEthAddr = Address.fromString(`eth:${ tokenMainnetAddress }`);
      if (
        event.tokenContract.toString() === tokenEthAddr.toString() &&
        event.tokenOwner.toString() === ownerMainnetAddr.toString()
      ) {
        clearTimeout(timer);
        timer = null;
        gatewayContract.removeAllListeners(TransferGateway.EVENT_TOKEN_WITHDRAWAL);
        resolve(event);
      }
    };
    gatewayContract.on(TransferGateway.EVENT_TOKEN_WITHDRAWAL, listener);
  });

  const tokenLoomAddr = Address.fromString(`${ client.chainId }:${ tokenLoomAddress }`);
  await gatewayContract.withdrawERC20Async(amount, tokenLoomAddr, ownerMainnetAddr);
  console.log(`${ amount.div(coinMultiplier).toString() } tokens deposited to DAppChain Gateway...`);

  const event = await receiveSignedWithdrawalEvent;
  return CryptoUtils.bytesToHexAddr(event.sig);
}

async function depositCoinToMainnetGateway(web3js, amount, ownerAccount, gas) {
  const contract = await getMainnetCoinContract(web3js);
  const contractAddress = await getMainnetCoinContractAddress(web3js);
  const gateway  = await getMainnetGatewayContract(web3js);

  let gasEstimate = await contract.methods
    .approve(mainnetGatewayAddress, amount.toString())
    .estimateGas({ from: ownerAccount });

  if (gasEstimate === gas) {
    throw new Error('Not enough enough gas, send more.');
  }

  await contract.methods
    .approve(mainnetGatewayAddress, amount.toString())
    .send({ from: ownerAccount, gas: gasEstimate });

  gasEstimate = await gateway.methods
    .depositERC20(amount.toString(), contractAddress)
    .estimateGas({ from: ownerAccount, gas });
      console.log(gasEstimate);

  if (gasEstimate === gas) {
    throw new Error('Not enough enough gas, send more.');
  }

  return gateway.methods
    .depositERC20(amount.toString(), contractAddress)
    .send({ from: ownerAccount, gas: gasEstimate });
}

async function withdrawCoinFromMainnetGateway({ web3, amount, accountAddress, signature, gas }) {
  const gatewayContract = await getMainnetGatewayContract(web3);
  const networkId = await web3.eth.net.getId();

  const gasEstimate = await gatewayContract.methods
    .withdrawERC20(amount.toString(), signature, CUEToken.networks[networkId].address)
    .estimateGas({ from: accountAddress, gas });

  if (gasEstimate === gas) {
    throw new Error('Not enough enough gas, send more.');
  }

  return gatewayContract.methods
    .withdrawERC20(amount.toString(), signature, CUEToken.networks[networkId].address)
    .send({ from: accountAddress, gas: gasEstimate });
}

async function mapAccounts(environment, ethKey, loomKey) {
  let client;
  try {
    const rinkeby = loadMainnetAccount(environment, ethKey);
    const loom = loadLoomAccount(environment, loomKey);
    client = loom.client;

    const signer = new OfflineWeb3Signer(rinkeby.web3, rinkeby.account);
    const ownerRinkebyAddr = Address.fromString(`eth:${ rinkeby.account.address }`);
    const ownerLoomAddr = Address.fromString(`${ client.chainId }:${ loom.account }`);

    const mapperContract = await AddressMapper.createAsync(client, ownerLoomAddr);
    try {
      const mapping = await mapperContract.getMappingAsync(ownerLoomAddr);
      console.log(`${ mapping.from.toString() } is already mapped to ${ mapping.to.toString() }`);
      return;
    } catch (err) {
      // assume this means there is no mapping yet, need to fix loom-js not to throw in this case
    }
    console.log(`mapping ${ ownerRinkebyAddr.toString() } to ${ ownerLoomAddr.toString() }`);
    await mapperContract.addIdentityMappingAsync(ownerLoomAddr, ownerRinkebyAddr, signer);
    console.log(`Mapped ${ ownerLoomAddr } to ${ ownerRinkebyAddr }`);
  } catch (err) {
    console.error(err);
  } finally {
    if (client) {
      client.disconnect();
    }
  }
}

async function getMainnetBalance(environment, ethKey) {
  const account = loadMainnetAccount(environment, ethKey);
  const address = account.account.address;
  const balance = await account.web3.eth.getBalance(address);
  return account.web3.utils.fromWei(balance, 'ether');
}

async function getMainnetCUEBalance(environment, ethKey) {
  const account = loadMainnetAccount(environment, ethKey);
  const address = account.account.address;
  this.CUETokenInstance = new account.web3.eth.Contract(
    CUEToken.abi,
    CUEToken.networks[4].address,
    { from: address }
  );

  const balance = await this.CUETokenInstance.methods.balanceOf(address).call({
    from: address
  });

  return new BN(balance).div(coinMultiplier).toString();
}

function depositCUE(environment, ethKey, amount) {
  return new Promise(async (resolve, reject) => {
    try {
      const mainnet = loadMainnetAccount(environment, ethKey);

      const actualAmount = new BN(amount).mul(coinMultiplier);
      const tx = await depositCoinToMainnetGateway(
        mainnet.web3, actualAmount, mainnet.account.address, 350000
      );

      resolve(tx);
      console.log(`${ amount } tokens deposited to Ethereum Gateway.`);
      console.log(`Rinkeby tx hash: ${ tx.transactionHash }`);
    } catch (err) {
      reject(err);
      console.error(err);
    }
  });
}

function withdrawCUE(environment, ethKey, loomKey, amount) {
  return new Promise(async (resolve, reject) => {
    let client;
    try {
      const mainnet = loadMainnetAccount(environment, ethKey);
      const loom = loadLoomAccount(environment, loomKey);
      client = loom.client;

      const actualAmount = new BN(amount).mul(coinMultiplier);
      const mainnetNetworkId = await mainnet.web3.eth.net.getId();
      const loomNetworkId = await loom.web3.eth.net.getId();
      const signature = await depositCoinToLoomGateway({
        client: loom.client,
        web3: loom.web3,
        amount: actualAmount,
        ownerLoomAddress: loom.account,
        ownerMainnetAddress: mainnet.account.address,
        tokenLoomAddress: CUETokenLoom.networks[loomNetworkId].address,
        tokenMainnetAddress: CUEToken.networks[mainnetNetworkId].address,
        timeout: 120000
      });

      const tx = await withdrawCoinFromMainnetGateway({
        web3: mainnet.web3,
        amount: actualAmount,
        accountAddress: mainnet.account.address,
        signature,
        gas: 350000
      });

      resolve(tx);
      console.log(`${ amount } tokens withdrawn from Ethereum Gateway.`);
      console.log(`Mainnet tx hash: ${ tx.transactionHash }`);
    } catch (err) {
      reject(err);
      console.error(err);
    } finally {
      if (client) {
        client.disconnect();
      }
    }
  });
}

function pendingWithdrawal(environment, ethKey, loomKey) {
  return new Promise(async (resolve, reject) => {
    let client;
    try {
      const mainnet = loadMainnetAccount(environment, ethKey);
      const loom = loadLoomAccount(environment, loomKey);
      client = loom.client;

      const networkId = await mainnet.web3.eth.net.getId();
      const myRinkebyCoinAddress = Address.fromString(`eth:${ CUEToken.networks[networkId].address }`);
      const ownerAddr = Address.fromString(`${ loom.client.chainId }:${ loom.account }`);
      const gatewayContract = await TransferGateway.createAsync(client, ownerAddr);
      const receipt = await gatewayContract.withdrawalReceiptAsync(ownerAddr);
      if (receipt) {
        resolve(receipt.value.div(coinMultiplier).toString());
      } else {
        resolve(null);
      }
    } catch (err) {
      reject(err);
      console.error(err);
    } finally {
      if (client) {
        client.disconnect();
      }
    }
  });
}

function resumeWithdrawal(environment, ethKey, loomKey) {
  return new Promise(async (resolve, reject) => {
    let client;
    try {
      const mainnet = loadMainnetAccount(environment, ethKey);
      const loom = loadLoomAccount(environment, loomKey);
      client = loom.client;

      const networkId = await mainnet.web3.eth.net.getId();
      const myRinkebyCoinAddress = Address.fromString(`eth:${ CUEToken.networks[networkId].address }`);
      const ownerAddr = Address.fromString(`${ loom.client.chainId }:${ loom.account }`);
      const gatewayContract = await TransferGateway.createAsync(client, ownerAddr);
      const receipt = await gatewayContract.withdrawalReceiptAsync(ownerAddr);
      const signature = CryptoUtils.bytesToHexAddr(receipt.oracleSignature);

      if (receipt.tokenContract.toString() === myRinkebyCoinAddress.toString()) {
        const tx = await withdrawCoinFromMainnetGateway({
          web3: mainnet.web3,
          amount: receipt.tokenAmount,
          accountAddress: mainnet.account.address,
          signature,
          gas: 350000
        });

        resolve(tx);
        console.log(`${ receipt.tokenAmount.div(coinMultiplier).toString() } tokens withdrawn from Etheruem Gateway.`);
        console.log(`Rinkeby tx hash: ${ tx.transactionHash }`);
      } else {
        reject('Unsupported asset type!');
        console.log('Unsupported asset type!');
      }
    } catch (err) {
      reject(err);
      console.error(err);
    } finally {
      if (client) {
        client.disconnect();
      }
    }
  });
}

function sendCUE(environment, ethKey, address, amount) {
  return new Promise(async (resolve, reject) => {
    try {
      const mainnet = loadMainnetAccount(environment, ethKey);
      const contract = await getMainnetCoinContract(mainnet.web3);

      const actualAmount = new BN(amount).mul(coinMultiplier);

      const gasEstimate = await contract.methods
        .transfer(address, actualAmount.toString())
        .estimateGas({ from: mainnet.account.address });

      const tx = await contract.methods
        .transfer(address, actualAmount.toString())
        .send({ from: mainnet.account.address, gas: gasEstimate });

      resolve(tx);
      console.log(`${ amount } tokens sent.`);
      console.log(`tx hash: ${ tx.transactionHash }`);
    } catch (err) {
      reject(err);
      console.error(err);
    }
  });
}

async function sendETH(environment, ethKey, address, amount) {
  return new Promise(async (resolve, reject) => {
    try {
      const mainnet = loadMainnetAccount(environment, ethKey);

      const tx = await mainnet.web3.eth.sendTransaction({
        from: mainnet.account.address,
        to: address,
        gas: 350000,
        value: mainnet.web3.utils.toWei(amount, 'ether')
      });

      resolve(tx);
      console.log(`${ amount } ETH sent.`);
      console.log(`tx hash: ${ tx.transactionHash }`);
    } catch (err) {
      reject(err);
      console.error(err);
    }
  });
}

exports.mapAccounts = mapAccounts;
exports.getMainnetBalance = getMainnetBalance;
exports.getMainnetCUEBalance = getMainnetCUEBalance;
exports.depositCUE = depositCUE;
exports.withdrawCUE = withdrawCUE;
exports.resumeWithdrawal = resumeWithdrawal;
exports.pendingWithdrawal = pendingWithdrawal;
exports.sendCUE = sendCUE;
exports.sendETH = sendETH;
