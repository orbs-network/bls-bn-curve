const chai = require('chai');
const dirtyChai = require('dirty-chai');
const BigNumber = require('bignumber.js');

// import expectRevert from './helpers/expectRevert';

// Run tests:  scripts/test.sh

// Step-by-step debugging in VSCode:
// npm install truffle-core --save-dev
// node --inspect-brk ./node_modules/truffle-core/cli.js test test/dkg_test.js
// "Attach" in VSCode (see .vscode/launch.json)


const {
  expect
} = chai;
chai.use(dirtyChai);

const ETH_URL = "http://127.0.0.1:7545";
const CONTRACT_ADDRESS = '0xF7d58983Dbe1c84E03a789A8A2274118CC29b5da';

const CLIENT_COUNT = 5;
const THRESHOLD = 2;
const DEPOSIT_WEI = 1000000000000000000; // 1e18

const CLIENTS = [{
    address: '0x6E0C57E9B3a8BfDe94e89105b78A7f8bc40e85A0',
    privateKey: 'a05e8bd12f53f6063feae2623273cca6f0747574c3101537ea1f5602737dc97e',
  },
  {
    address: '0xc761554c5EBE2303163fdb8319c0bA5b6bAB6526',
    privateKey: '9f47537b57875335b059ad59ce1c4a02b2504158ee8df36879ef44723f364deb',
  },
  {
    address: '0xa9C4381A5f6f9C7B8d525696436184B5f8763154',
    privateKey: '16b92ef93d268d20ec5078ef17b35605e7ba800a198b6916fbdc86bfced6f060',
  },
  {
    address: '0xA590aB8FFfb627C78c1632Ea986115f0c5d9f3bd',
    privateKey: 'ebf09917aac97a881851b828ce4e3e45d7fb7071577456ea932b17ec0fa04507',
  },
  {
    address: '0x501106e7c52dBe89A8a67378A17586649E053C25',
    privateKey: '4fd18d7b4d391ffede4d2f7691de47252be47bda95f10bcfe7ee399d181a8723',
  }
]


const DKG = artifacts.require('../contracts/dkg.sol');
let dkg;

contract('DKG', (accounts) => {
  it('should call DKG methods', async () => {
    // const greeting = 'Hello World!';
    // const greeter = await Greeter.new(greeting)
    dkg = await DKG.new(THRESHOLD, CLIENT_COUNT);

    await joinAllClients();
    await commitAllClients();
    // await signAndVerify();
    // expect(await greeter.greeting.call()).to.eql(greeting);
  });

  // it('should be able to change the greeting', async () => {
  //   const greeting = 'Hello World!';
  //   const greeting2 = 'Bye bye!';
  //   const greeter = await Greeter.new(greeting)

  //   await greeter.setGreeting(greeting2);
  //   expect(await greeter.greeting.call()).to.eql(greeting2);
  // });
});

async function join(client, i) {
  // const res = await new Promise((resolve, reject) => {
  //   if (!dkg.join) {
  //     reject(new Error('No join() method on contract!'));
  //   }
  console.log(`Calling join() with client #${i} ${client.address}`);
  const res = await dkg.join(web3.toBigNumber(i), {
    from: client.address,
    // value: DEPOSIT_WEI,
    gasLimit: 3000000,
  });
  // , (err, result) => {
  //   if (err !== null) {
  //     console.log(`Failed to join() with client #${i} ${client.address}. msg=${err.msg} Err=${JSON.stringify(err)}`);
  //     return reject(err);
  //   }
  console.log(`Client #${i} ${client.address} joined successfully. Result: ${JSON.stringify(res)}`);
  //   client.id = result;
  //   return resolve(result);
  // });
  // });
  return res;
}

async function joinAllClients() {
  console.log('=====> join <=====');
  const promises = [];
  CLIENTS.forEach((client, i) => {
    promises.push(join(client, i));
  });
  promises.push(() => {
    setTimeout(1000);
  });
  const res = await Promise.all(promises);
  return res;
}

/// Commit

async function commitAllClients() {
  console.log(` =====> commit <=====`);
  const promises = [];
  CLIENTS.forEach((client, i) => {
    console.log(`Calling commit() with client #${i} ${client.address}`);
    promises.push(commit(client, i));
  });
  promises.push(() => {
    setTimeout(1000);
  });
  const res = await Promise.all(promises);
  return res;
}

async function commit(client, i) {
  // return new Promise((resolve, reject) => {
  const pubCommit = getPubCommit();
  const prCommit = getPrCommit();
  // if (!dkg.commit) {
  // reject('No commit() method on contract!');
  // }
  if (!client.id) {
    throw new Error(`Missing client id for client #${i}. Client id is the result of join(). Did join() finished correctly?`);
  }

  console.log(`Commit(): client.id=${client.id} pubCommit=${JSON.stringify(pubCommit)} prCommit=${JSON.stringify(prCommit)}`);

  const result = await dkg.commit(client.id, pubCommit, prCommit, {
    from: client.address,
    gasLimit: 3000000
  });
  // , (err, result) => {
  //     if (err !== null) {
  //         console.log(`Commit(): Failed to commit() with client #${i} ${client.address}. msg=${err.msg} Err=${JSON.stringify(err)}`);
  //         return reject(err);
  //     }
  console.log(`Commit(): Client #${i} ${client.address} committed successfully. Result: ${JSON.stringify(result)}`);
  // client.id = result;
  // resolve(result);
  // });
  // });
}


function signAndVerify() {
  return true;
}

// This should call Go code - it is just a mock here
function getPubCommit() {

  const SOME_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104103';
  const res = [];
  const pubCommitLength = THRESHOLD * 2 + 2;
  for (let i = 0; i < pubCommitLength; i++) {
    res.push(web3.toBigNumber(SOME_BIG_NUMBER));
  }
  return res;
}

// This should call Go code - it is just a mock here
function getPrCommit() {
  const ANOTHER_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104104';
  const res = [];
  const prCommitLength = CLIENT_COUNT;
  for (let i = 0; i < prCommitLength; i++) {
    res.push(web3.toBigNumber(ANOTHER_BIG_NUMBER));
  }
  return res;
}