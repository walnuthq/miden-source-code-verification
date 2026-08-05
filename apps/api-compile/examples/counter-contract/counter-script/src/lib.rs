// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

// However, we could still use some standard library types while
// remaining no-std compatible, if we uncommented the following lines:
//
//
// extern crate alloc;
// use alloc::vec::Vec;

use miden::*;

/// Native account of the script: exposes the `counter-contract` component methods gathered from
/// the `counter-contract` package. The struct cannot be named `CounterContract`, because the
/// account reference generates a trait of that name.
#[account(counter_contract::CounterContract)]
pub struct Counter;

#[tx_script]
fn run(_arg: Word, account: &mut Counter) {
    account.increment_count();
}
