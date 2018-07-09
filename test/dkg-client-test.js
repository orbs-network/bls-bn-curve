/*

Ganache mnemonic for account generation:
decorate provide ritual swarm will inmate sausage lab banana daring trash liar

Not using web3 1.0.0 beta because its docs are not as good as 0.20.x

*/


const ETH_URL = "http://127.0.0.1:7545";
const CONTRACT_ADDRESS = '0xF7d58983Dbe1c84E03a789A8A2274118CC29b5da';
const DEPOSIT_WEI = 1000000000000000000; // 1e18

const CLIENTS = [{
        address: '0x6E0C57E9B3a8BfDe94e89105b78A7f8bc40e85A0',
        privateKey: 'a05e8bd12f53f6063feae2623273cca6f0747574c3101537ea1f5602737dc97e'
    },
    {
        address: '0xc761554c5EBE2303163fdb8319c0bA5b6bAB6526',
        privateKey: '9f47537b57875335b059ad59ce1c4a02b2504158ee8df36879ef44723f364deb'
    },
    {
        address: '0xa9C4381A5f6f9C7B8d525696436184B5f8763154',
        privateKey: '16b92ef93d268d20ec5078ef17b35605e7ba800a198b6916fbdc86bfced6f060'
    },
    {
        address: '0xA590aB8FFfb627C78c1632Ea986115f0c5d9f3bd',
        privateKey: 'ebf09917aac97a881851b828ce4e3e45d7fb7071577456ea932b17ec0fa04507'
    },
    {
        address: '0x501106e7c52dBe89A8a67378A17586649E053C25',
        privateKey: '4fd18d7b4d391ffede4d2f7691de47252be47bda95f10bcfe7ee399d181a8723'
    }
]

fs = require('fs');

const assert = require('assert');
const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider(ETH_URL));
const mocha = require('mocha').mocha;
const CLIENT_COUNT = 5;
const THRESHOLD = 2;

const contractAbi = fs.readFileSync('./test/dkg.abi');


// myContract.options = {
//     address: CONTRACT_ADDRESS,
//     // jsonInterface: [...],
//     from: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe',
//     gasPrice: '10000000000000',
//     gas: 1000000
// }



// beforeEach(async () => {
//Get a list of all accounts
// accounts = await web3.eth.getAccounts();
// await web3.eth.sendTransaction({
//     from: web3.eth.accounts[0],
//     to: web3.eth.accounts[1],
//     value: web3.web3.toWei(50, 'ether')
// });
// });

describe('Inbox', () => {
    it('deploys a contract', async () => {
        // console.log(accounts);

        const Contract = web3.eth.contract(JSON.parse(contractAbi));

        // var myContractInstance = MyContract.new(param1, param2, {data: myContractCode, gas: 300000, from: mySenderAddress});
        // myContractInstance.transactionHash // The hash of the transaction, which created the contract
        // myContractInstance.address


        console.log('Get contract at address', CONTRACT_ADDRESS);
        const myContract = Contract.at(CONTRACT_ADDRESS);
        //console.log(myContract);
        // var tx = new ethereumjs.Tx({
        //     nonce: 0,
        //     gasPrice: web3.toHex(web3.toWei('20', 'gwei')),
        //     gasLimit: 100000,
        //     to: CONTRACT_ADDRESS,
        //     value: DEPOSIT_WEI
        //     // data: data,
        // });
        // tx.sign(ethereumjs.Buffer.Buffer.from(privateKey, 'hex'));


        // myContract.deploy()
        // var raw = '0x' + tx.serialize().toString('hex');
        // web3.eth.sendRawTransaction(raw, function (err, transactionHash) {
        // console.log(transactionHash);
        // });


        // console.log('Call join(). Gas price: ', web3.eth.gas);
        // myContract.join.estimateGas({
        //     from: CLIENTS[0].address,
        //     value: DEPOSIT_WEI,
        //     gas: 2000000
        // }, (err, result) => {
        //     console.log('err', err);
        //     console.log('Estimated gas price: ', result);
        // });

        console.log(` =====> join <=====`);

        return joinAllClients()
            .then(() => {
                console.log(` =====> commit <=====`);
                return commitAllClients();
            })
            .then(() => {
                signAndVerify();
                assert(true);
            })
            .catch(err => {
                console.log(`Error: ${err.message} ${JSON.stringify(err)}`);
                assert(false);
            });
    });

    // await timeout(1000);

    console.log(`Clients: ${JSON.stringify(CLIENTS)}`);





    // function commit(uint16 senderIndex, uint256[] pubCommit, uint256[] prCommit)

    // myContract.methods.join().send({
    //         from: CLIENTS[0].address,

    //     })
    //     .on('transactionHash', function (hash) {
    //         console.log('hash', hash);
    //     })
    //     .on('receipt', function (receipt) {
    //         console.log('receipt', receipt);
    //     })
    //     .on('confirmation', function (confirmationNumber, receipt) {
    //         console.log('conf', confirmationNumber, 'receipt', receipt);
    //     })
    //     .on('error', console.error);
});

/// Commit

function commitAllClients() {
    const promises = [];
    CLIENTS.forEach((client, i) => {
        console.log(`Calling commit() with client #${i} ${client.address}`);
        promises.push(commit(client));
    });
    return Promise.all(promises);
}

function commit(client) {
    return new Promise((resolve, reject) => {
        myContract.commit(client.id, pubCommit, prCommit, {
            from: client.address,
            value: DEPOSIT_WEI,
            gasLimit: 3000000
        }, (err, result) => {
            console.log('err', err);
            if (err !== null) {
                console.log(`Failed to commit() with client #${i} ${client.address}`);
                reject(err);
            }
            console.log(`Client #${i} ${client.address} committed successfully. Result: ${result}`);
            client.id = result;
            resolve(result);
        });
    });
}

/// Join

function joinAllClients() {
    const promises = [];
    CLIENTS.forEach((client, i) => {
        console.log(`Calling join() with client #${i} ${client.address}`);
        promises.push(join(client));
    });
    return Promise.all(promises);
}


function join(client) {
    return new Promise((resolve, reject) => {
        myContract.join({
            from: client.address,
            value: DEPOSIT_WEI,
            gasLimit: 3000000
        }, (err, result) => {
            console.log('err', err);
            if (err !== null) {
                console.log(`Failed to join() with client #${i} ${client.address}`);
                reject(err);
            }
            console.log(`Client #${i} ${client.address} joined successfully. Result: ${result}`);
            client.id = result;
            resolve(result);
        });
    });
}