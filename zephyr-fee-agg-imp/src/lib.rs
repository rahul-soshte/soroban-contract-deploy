use zephyr_sdk::{soroban_sdk::xdr::{FeeBumpTransactionInnerTx, Operation, OperationBody, TransactionEnvelope, TransactionResultResult}, Condition, DatabaseDerive, DatabaseInteract, EnvClient};
use zephyr_sdk::bincode;
use zephyr_sdk::ZephyrVal;
use serde::{Deserialize, Serialize};


#[derive(Serialize, Clone)]
pub struct StatsResponse {
    pub time_st: u64,
    // pub classic: i64,
    // pub contracts: i64,
    // pub other: i64,
    pub avg_s: String,
    pub avg_c: String,
}

impl From<&Stats> for StatsResponse {
    fn from(value: &Stats) -> Self {
        Self { time_st: value.time_st, avg_s: value.avg_s.to_string(), avg_c: value.avg_c.to_string() }
    }
}

#[derive(Serialize, DatabaseDerive, Clone)]
#[with_name("avgfee")]
pub struct Stats {
    pub time_st: u64,
    pub classic: i128,
    pub contracts: i128,
    pub other: i128,
    pub avg_s: f64,
    pub avg_c: f64,

}

#[derive(Serialize, Deserialize)]
pub struct LastLedgerRequest {
    lastnl: u32,
}


// Slightly updated version for precision correctness.
// Please note that this design is not the most efficient (and it hasn't been thought through much) and can definitely be improved. This
// is the result of an on-the-fly coded program in the Stellar Event "Working with Data on Stellar, the Role of Indexers and Live-Coding a ZephyrVM Program".
#[no_mangle]
pub extern "C" fn on_close() {

    // Environment and Reader Initialization:
    let env = EnvClient::new();

    let reader = env.reader();
    let time_st = reader.ledger_timestamp();

    let (contract, classic, other, avg_soroban, avg_classic) = {
        let mut contract_invocations = 0;
        let mut classic = 0;
        let mut other_soroban = 0;
        let mut tot_soroban_fee = 0;
        let mut tot_classic_fee = 0;
        
        let envelopes = reader.envelopes_with_meta();
        let mut successful_envelopes = 0;
        
        // Iterates through transaction envelopes:
        for (envelope, meta) in &envelopes {
            let charged = meta.result.result.fee_charged;

            let success = match meta.result.result.result {
                TransactionResultResult::TxSuccess(_) => true,
                TransactionResultResult::TxFeeBumpInnerSuccess(_) => true,
                _ => false
            };

            if success {
                successful_envelopes += 1;
                match envelope {
                    // Counting Operations and Fees for Tx
                    TransactionEnvelope::Tx(v1) => {
                        count_ops_and_fees(v1.tx.operations.to_vec(), charged, &mut classic, &mut contract_invocations, &mut other_soroban, &mut tot_soroban_fee, &mut tot_classic_fee)

                    },

                    // Counting Operations and Fees for Tx Fee Bump
                    TransactionEnvelope::TxFeeBump(feebump) => {
                        let FeeBumpTransactionInnerTx::Tx(v1) = &feebump.tx.inner_tx;
                        count_ops_and_fees(v1.tx.operations.to_vec(), charged, &mut classic, &mut contract_invocations, &mut other_soroban, &mut tot_soroban_fee, &mut tot_classic_fee)
                    },

                    // Counting Operations and Fees for Tx V0
                    TransactionEnvelope::TxV0(v0) => {
                        count_ops_and_fees(v0.tx.operations.to_vec(), charged, &mut classic, &mut contract_invocations, &mut other_soroban, &mut tot_soroban_fee, &mut tot_classic_fee)
                    }
                }
            }
        };

        let avg_soroban: f64 = if contract_invocations > 0 { tot_soroban_fee as f64 / contract_invocations as f64 } else { 0.0 };
        let avg_classic: f64 = if classic > 0 { tot_classic_fee as f64 / (successful_envelopes - contract_invocations) as f64 } else { 0.0 };

        (contract_invocations as i128, classic as i128, other_soroban as i128, avg_soroban, avg_classic)
    };

    // env.log().debug("Are we coming here", None);
    env.log().debug(format!("Avg Soroban, Avg Classic {:?} {:?}", avg_soroban, avg_classic), None);
    // env.log().debug("Are we coming here", avg_soroban.into());
    // env.log().debug("Are we coming here", avg_classic.into());

    // Just insert the fee into it,
    env.put(&Stats {
        time_st,
        classic,
        contracts: contract,
        other,
        avg_s: avg_soroban,
        avg_c: avg_classic,
    });
    
    
    env.log().debug("Successfully wrote to the database", None);

}

//TODO: Get Current Ledger
//TODO: Calculate the Last 5 ledgers = 25 seconds timeline
//TODO: Calculate the last 10 ledgers = 50 second timeline
//TODO: Calculate the last 30 ledgers = 150 seconds timeline
//TODO: Custom API for timestamp filtering


// Ask for data back `n` ledgers
#[no_mangle]
pub extern "C" fn get_last() {
    let env = EnvClient::empty();
    let request: LastLedgerRequest = env.read_request_body();
    let ledgers: Vec<Stats> = env.read::<Stats>();
    let len = ledgers.len();
    let last_5: Vec<StatsResponse> = ledgers[len.saturating_sub(request.lastnl as usize)..].iter().map(|stat| stat.into()).collect();
    
    env.conclude(&last_5)
}

// helper function
fn count_ops_and_fees(ops: Vec<Operation>, txfee: i64, classic: &mut i32, contract_invocations: &mut i32, other_soroban: &mut i32, tot_soroban_fee: &mut i64, tot_classic_fee: &mut i64) {
    // only 1 invokehostfn operations can be in one transaction
    if let Some(op) = ops.get(0) {
        if let OperationBody::InvokeHostFunction(_) = op.body {
            *tot_soroban_fee += txfee;
        } else {
            *tot_classic_fee += txfee
        }
    }
    
    for op in ops.iter() {
        match op.body {
            OperationBody::InvokeHostFunction(_) => {
                *contract_invocations += 1;
            },
            OperationBody::ExtendFootprintTtl(_) => {
                *other_soroban += 1;
            },
            OperationBody::RestoreFootprint(_) => {
                *other_soroban += 1;
            },
            _ => {
                *classic += 1;
            }
        }
    }
}
