const {
  Client, LocalAddress, CryptoUtils, LoomProvider, CachedNonceTxMiddleware, SignedTxMiddleware
} = require('loom-js');

const Web3 = require('web3');
const BN = require('bn.js');

const CUEToken = require('./abi/CUETokenLoom.json');
const CUETips = require('./abi/CUETips.json');
const CUEBookings = require('./abi/CUEBookings.json');
const CUEDisputeResolution = require('./abi/CUEDisputeResolution.json');

const coinMultiplier = new BN(10).pow(new BN(18));

exports.PlasmaContracts = class PlasmaContracts {
  async loadContract(environment, privateKey) {
    this.onEvent = null;
    this._createClient(environment, privateKey);
    this._createCurrentUserAddress();
    this._createWebInstance();
    await this._createContractInstance();
  }

  _createClient(environment, privateKey) {
    this.privateKey = privateKey;
    this.publicKey = CryptoUtils.publicKeyFromPrivateKey(this.privateKey);

    let writeUrl;
    let readUrl;
    let networkId;

    if (environment === 'local') {
      writeUrl = 'ws://127.0.0.1:46658/websocket';
      readUrl = 'ws://127.0.0.1:46658/queryws';
      networkId = 'default';
    } else if (environment === 'extdev') {
      writeUrl = 'ws://extdev-plasma-us1.dappchains.com:80/websocket';
      readUrl = 'ws://extdev-plasma-us1.dappchains.com:80/queryws';
      networkId = 'extdev-plasma-us1';
    }

    this.client = new Client(networkId, writeUrl, readUrl);

    this.client.on('error', msg => {
      console.error('Error on connect to client', msg);
      console.warn('Please verify if loom command is running');
    });
  }

  _createCurrentUserAddress() {
    this.currentUserAddress = LocalAddress.fromPublicKey(this.publicKey).toString();
  }

  _setupMiddlewareFn(client, privateKey) {
    const publicKey = CryptoUtils.publicKeyFromPrivateKey(privateKey);
    return [new CachedNonceTxMiddleware(publicKey, client), new SignedTxMiddleware(privateKey)];
  }

  _createWebInstance() {
    this.web3 = new Web3(
      new LoomProvider(
        this.client,
        this.privateKey,
        this._setupMiddlewareFn
      )
    );
  }

  async _createContractInstance() {
    const networkId = await this._getCurrentNetwork();

    this.CUETokenInstance = new this.web3.eth.Contract(
      CUEToken.abi,
      CUEToken.networks[networkId].address,
      { from: this.currentUserAddress }
    );

    this.CUETipsInstance = new this.web3.eth.Contract(
      CUETips.abi,
      CUETips.networks[networkId].address,
      { from: this.currentUserAddress }
    );

    this.CUEBookingsInstance = new this.web3.eth.Contract(
      CUEBookings.abi,
      CUEBookings.networks[networkId].address,
      { from: this.currentUserAddress }
    );

    this.CUEDisputeResolutionInstance = new this.web3.eth.Contract(
      CUEDisputeResolution.abi,
      CUEDisputeResolution.networks[networkId].address,
      { from: this.currentUserAddress }
    );

    this.CUETipsInstance.events.TransferSuccessful((err, event) => {
      if (err) console.error('Error on event', err);
      else if (this.onEvent) {
        console.log('transfer successful', event);
        this.onEvent(event.returnValues);
      }
    });
  }

  addEventListener(fn) {
    this.onEvent = fn;
  }

  async _getCurrentNetwork() {
    return Promise.resolve('9545242630824');
    // return Promise.resolve('default')
  }

  async getBalance() {
    const balance = await this.CUETokenInstance.methods.balanceOf(this.currentUserAddress).call({
      from: this.currentUserAddress
    });

    return new BN(balance).div(coinMultiplier).toString();
  }

  async tip(address, amount, room) {
    await this.CUETokenInstance.methods
      .approve(this.CUETipsInstance._address.toLowerCase(), new BN(amount).mul(coinMultiplier).toString())
      .send({ from: this.currentUserAddress.toLowerCase() });

    const response = await this.CUETipsInstance.methods
      .tip(address.toLowerCase(), new BN(amount).mul(coinMultiplier).toString(), room)
      .send({ from: this.currentUserAddress.toLowerCase() });

    return response;
  }

  async newBooking(id, performer, pay, startTime, endTime) {
    await this.CUETokenInstance.methods
      .approve(this.CUEBookingsInstance._address.toLowerCase(), new BN(pay).mul(coinMultiplier).toString())
      .send({ from: this.currentUserAddress.toLowerCase() });

    await this.CUEBookingsInstance.methods
      .newBooking(this.web3.utils.fromUtf8(id), performer, new BN(pay).mul(coinMultiplier).toString(), startTime, endTime)
      .send({ from: this.currentUserAddress.toLowerCase() });
  }

  async getBooking(id) {
    return this.CUEBookingsInstance.methods
      .getBooking(this.web3.utils.fromUtf8(id))
      .call({ from: this.currentUserAddress.toLowerCase() });
  }

  async acceptBooking(id) {
    return this.CUEBookingsInstance.methods
      .getBooking(this.web3.utils.fromUtf8(id))
      .send({ from: this.currentUserAddress.toLowerCase() });
  }

  async declineBooking(id) {
    return this.CUEBookingsInstance.methods
      .declineBooking(this.web3.utils.fromUtf8(id))
      .send({ from: this.currentUserAddress.toLowerCase() });
  }

  async cancelBooking(id) {
    return this.CUEBookingsInstance.methods
      .cancelBooking(this.web3.utils.fromUtf8(id))
      .send({ from: this.currentUserAddress.toLowerCase() });
  }

  async withdrawPay(id) {
    return this.CUEBookingsInstance.methods
      .withdrawPay(this.web3.utils.fromUtf8(id))
      .send({ from: this.currentUserAddress.toLowerCase() });
  }

  async withdrawPayUnclaimed(id) {
    return this.CUEBookingsInstance.methods
      .withdrawPayUnclaimed(this.web3.utils.fromUtf8(id))
      .send({ from: this.currentUserAddress.toLowerCase() });
  }

  async agentClaim(id) {
    return this.CUEBookingsInstance.methods
      .agentClaim(this.web3.utils.fromUtf8(id))
      .send({ from: this.currentUserAddress.toLowerCase() });
  }

  async performerClaim(id) {
    return this.CUEBookingsInstance.methods
      .performerClaim(this.web3.utils.fromUtf8(id))
      .send({ from: this.currentUserAddress.toLowerCase() });
  }

  async getDispute(id) {
    return this.CUEDisputeResolution.methods
      .getDispute(this.web3.utils.fromUtf8(id))
      .call({ from: this.currentUserAddress.toLowerCase() });
  }
};
