import * as StellarSDK from '@stellar/stellar-sdk';
const server = new StellarSDK.SorobanRpc.Server('https://soroban-testnet.stellar.org:443');
const sourceKeypair = StellarSDK.Keypair.fromSecret('SB66VLFNPAMBIAS5FLPY5NEKALZA64INYELFYEGPT53UI7S6ORPMSLK5');
const contractId = 'CBFXLDMHC65DVNJWALDXF7VKQIRZ7T4FHWFLLTMAU72EUXC6KET5MV45';
const sourceAccount = await server.getAccount(sourceKeypair.publicKey())
const contract = new StellarSDK.Contract(contractId);

// Reference for sorobill function
// https://github.com/kalepail/sorobill
function sorobill(sim, tx_xdr) {
  
  const events = sim.result.events.map((e) => {
    const buffer_val = Buffer.from(e, 'base64');
    let parsedEvent = StellarSDK.xdr.DiagnosticEvent.fromXDR(buffer_val);
  
    if (parsedEvent.event().type().name !== 'contract')
          return 0;

    return parsedEvent.event().toXDR().length;
  });


  const events_and_return_bytes = (
      events.reduce(
          (accumulator, currentValue) => accumulator + currentValue, 0 // Initialize accumulator with 0
      ) + (sim.result.results[0] ? sim.result.results[0].xdr.length : 0) // Return value size
  );


  const sorobanTransactionData = StellarSDK.xdr.SorobanTransactionData.fromXDR(sim.result.transactionData, 'base64');
  const resources = sorobanTransactionData.resources();
  const stroopValue = sorobanTransactionData.resourceFee().toString();

  const xlmValue = Number(stroopValue) * 10**(-7);

  const rwro = [
      sorobanTransactionData.resources().footprint().readWrite()
      .flatMap((rw) => rw.toXDR().length),
      sorobanTransactionData.resources().footprint().readOnly()
      .flatMap((ro) => ro.toXDR().length)
  ].flat();

  const metrics = {
      mem_byte: Number(sim.result.cost.memBytes),
      cpu_insn: Number(sim.result.cost.cpuInsns)
  };

 
  const stats = {
      // The maximum number of instructions this transaction can use
      cpu_insns: metrics.cpu_insn,
      
      mem_bytes: metrics.mem_byte,
      entry_reads: resources.footprint().readOnly().length + resources.footprint().readWrite().length,
      entry_writes: resources.footprint().readWrite().length,
      // The maximum number of bytes this transaction can read from ledger
      read_bytes: resources.readBytes(),
      // NOTE This covers both `contractDataEntrySizeBytes` in the case of a contract invocation and `contractMaxSizeBytes` in the case of a WASM install
      // The maximum number of bytes this transaction can write to ledger
      write_bytes: resources.writeBytes(),
      events_and_return_bytes,
      /* NOTE
          This field isn't terribly useful as the actual tx size may be larger once you've added all the signatures
          If the tx doesn't even have the sorobanData or auth applied this will be even less useful (and so we `undefined` it)
      */
      min_txn_bytes: tx_xdr ? tx_xdr.length : undefined,
      /* NOTE
          This limit is the max single ledger entry size
          You can write 25 keys with a sum total size of 65 KB and a single key max of 64 KB
          It currently cannot be derived from either the tx or the simulation (boo)
          (see https://discord.com/channels/897514728459468821/966788672164855829/1212887348191166484)
          If you're submitting a wasm upload up the max value is likely the wasm binary size
      */
      max_key_bytes: Math.max(...rwro),
      // max_entry_bytes: tx ? entries?.length ? Math.max(...entries) : 0 : undefined,
      resource_fee_in_xlm: xlmValue,
  };

  return stats;
}


const transaction = new StellarSDK.TransactionBuilder(sourceAccount, { fee: StellarSDK.BASE_FEE, networkPassphrase: StellarSDK.Networks.TESTNET })
  .addOperation(
    contract.call(
      "hello",
      StellarSDK.xdr.ScVal.scvSymbol('Dev'),
    ),
  )
  .setTimeout(30)
  .build();

// const tx_xdr = transaction.toEnvelope().toXDR('base64');

const tx_xdr = "AAAAAgAAAACWDRNrgN4HpWfA2B7H3QSMtt7GSK/J3/cH+i/Waf406QExLQAAAAL7AABAZwAAAAEAAAAAAAAAAAAAAABmtQMYAAAAAAAAAAEAAAABAAAAAJYNE2uA3gelZ8DYHsfdBIy23sZIr8nf9wf6L9Zp/jTpAAAAGAAAAAAAAAABKrf0Z9GS/LKu+hOOCq4fWWIWaS1ePWMaLC7oHiY6uD8AAAAJc2V0X3ByaWNlAAAAAAAAAgAAABAAAAABAAAABwAAAAoAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAAAAAAAAEBrNWXoAAAAKAAAAAAAAAAAAAFsFmk6VOQAAAAoAAAAAAAAAAAAABC7JTh37AAAACgAAAAAAAAAAAAAAVjr7wbwAAAAKAAAAAAAAAAAAAAARbJhDMgAAAAoAAAAAAAAAAAAAYgjQpjcUAAAABQAAAZEzE3mAAAAAAQAAAAAAAAAAAAAAASq39GfRkvyyrvoTjgquH1liFmktXj1jGiwu6B4mOrg/AAAACXNldF9wcmljZQAAAAAAAAIAAAAQAAAAAQAAAAcAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAoAAAAAAAAAAAAAABAazVl6AAAACgAAAAAAAAAAAABbBZpOlTkAAAAKAAAAAAAAAAAAAAQuyU4d+wAAAAoAAAAAAAAAAAAAAFY6+8G8AAAACgAAAAAAAAAAAAAAEWyYQzIAAAAKAAAAAAAAAAAAAGII0KY3FAAAAAUAAAGRMxN5gAAAAAAAAAABAAAAAAAAAAEAAAAH34iCDiMa2PMCeHHl3Tz0VJHXt3NeeFcxRmv8KUYAhggAAAAHAAAABgAAAAEqt/Rn0ZL8sq76E44Krh9ZYhZpLV49YxosLugeJjq4PwAAAAkAAAGRMxN5gAAAAAAAAAABAAAAAAAAAAYAAAABKrf0Z9GS/LKu+hOOCq4fWWIWaS1ePWMaLC7oHiY6uD8AAAAJAAABkTMTeYAAAAAAAAAAAgAAAAAAAAAGAAAAASq39GfRkvyyrvoTjgquH1liFmktXj1jGiwu6B4mOrg/AAAACQAAAZEzE3mAAAAAAAAAAAMAAAAAAAAABgAAAAEqt/Rn0ZL8sq76E44Krh9ZYhZpLV49YxosLugeJjq4PwAAAAkAAAGRMxN5gAAAAAAAAAAEAAAAAAAAAAYAAAABKrf0Z9GS/LKu+hOOCq4fWWIWaS1ePWMaLC7oHiY6uD8AAAAJAAABkTMTeYAAAAAAAAAABQAAAAAAAAAGAAAAASq39GfRkvyyrvoTjgquH1liFmktXj1jGiwu6B4mOrg/AAAACQAAAZEzE3mAAAAAAAAAAAYAAAAAAAAABgAAAAEqt/Rn0ZL8sq76E44Krh9ZYhZpLV49YxosLugeJjq4PwAAABQAAAABAIlUQAAAnEAAAAu4AAAAAACYloAAAAABzKXZYAAAAEACmqRBpXbFU8qKDK5RblnLKbH5D5r0y1D8YdbuwHxFfP8cjzI7MqatezfTpaVCOxgjCINZk0JMk5bZjdHG6iAM"

let requestBody = {
  "jsonrpc": "2.0",
  "id": 8675309,
  "method": "simulateTransaction",
  "params": {
    "transaction": tx_xdr,
    "resourceConfig": {
      "instructionLeeway": 3000000
    }
  }
}

let res = await fetch("https://soroban-testnet.stellar.org", {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(requestBody),
})

let simulateResponse = await res.json();
let sorocosts = sorobill(simulateResponse, tx_xdr)
let inclusionFee = await server.getFeeStats();
inclusionFee = inclusionFee.sorobanInclusionFee.max
let totalEstimatedFee = sorocosts.resource_fee_in_xlm + inclusionFee
console.log("Contract Costs ", sorocosts )
console.log("Total Fees ", totalEstimatedFee)



