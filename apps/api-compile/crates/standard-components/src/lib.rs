//! The account components `miden-standards` ships, and which of them an
//! account's procedures make up.
//!
//! `miden-import` names them for the web-viewer, and `miden-verifier` refuses
//! to verify an account they make up alone: one list for both, so a component
//! the import names is one the verifier counts as standard. Upstream's own
//! detection (`AccountComponentInterface::from_procedures`) knows only
//! fourteen of them.

use std::collections::BTreeSet;

use miden_protocol::account::{AccountComponentCode, AccountProcedureRoot};
use miden_standards::account::access::{
    Authority, Ownable2Step, Pausable, PausableManager, RoleBasedAccessControl,
};
use miden_standards::account::auth::{
    AuthGuardedMultisig, AuthMultisig, AuthMultisigSmart, AuthNetworkAccount, AuthSingleSig,
    AuthTxFeeCollector, NoAuth,
};
use miden_standards::account::faucets::{FungibleFaucet, NonFungibleFaucet};
use miden_standards::account::fees::{BasicConstantFeePolicy, ConstantFeeManager};
use miden_standards::account::inspection::{AccountSchemaCommitment, CodeInspection};
use miden_standards::account::note_creator::NoteCreator;
use miden_standards::account::oracle::PriceOracle;
use miden_standards::account::policies::{
    AllowlistManager, BasicAllowlist, BasicBlocklist, BlocklistManager, BurnAllowAll,
    BurnOwnerOnly, MinBurnAmount, MintAllowAll, MintOwnerOnly, TokenPolicyManager,
    TokenPolicyManagerV2, TransferAllowAll,
};
use miden_standards::account::upgrade::UpgradeManager;
use miden_standards::account::wallets::BasicWallet;

/// The accessor of a standard component's code.
pub type ComponentCode = fn() -> &'static AccountComponentCode;

/// Every account component `miden-standards` ships, by the name the import
/// is named under and the accessor of its code, in the order they claim an
/// account's procedures.
///
/// It extends `StandardAccountComponent::extract_standard_components` (which
/// the verifier reaches through `AccountComponentInterface::from_procedures`):
/// its fourteen come in its order and under the verifier's names, and the
/// crate's other components are added, so an account embedding one (a
/// pausable faucet, a mint policy) has it named too. `SchemaCommitment` is one
/// upstream leaves out that matters most: `build_with_schema_commitment`, what
/// the miden CLI builds accounts with by default, adds it to every account.
/// `lists_every_standard_component` holds the list to the crate's.
///
/// Order matters where two components share procedures: the earlier one claims
/// them. So a component must come before any whose procedures are all among
/// its own (`BasicWallet` before `NoteCreator`, whose only procedure is
/// `create_note`), and a faucet before `CodeInspection`, which shares a
/// procedure with both faucets, as upstream orders `FungibleFaucet`. The other
/// components that share procedures are alternatives to one another (the two
/// faucets, the multisigs, the two token policy managers) and aren't installed
/// together. `standard_components_claim_in_order` checks the first rule.
pub const STANDARD_COMPONENTS: &[(&str, ComponentCode)] = &[
    ("BasicWallet", BasicWallet::code),
    ("NoteCreator", NoteCreator::code),
    ("FungibleFaucet", FungibleFaucet::code),
    ("NonFungibleFaucet", NonFungibleFaucet::code),
    ("CodeInspection", CodeInspection::code),
    ("Authority", Authority::code),
    ("RoleBasedAccessControl", RoleBasedAccessControl::code),
    ("Ownable2Step", Ownable2Step::code),
    ("AuthSingleSig", AuthSingleSig::code),
    ("AuthGuardedMultisig", AuthGuardedMultisig::code),
    ("AuthMultisig", AuthMultisig::code),
    ("AuthMultisigSmart", AuthMultisigSmart::code),
    ("AuthNoAuth", NoAuth::code),
    ("AuthNetworkAccount", AuthNetworkAccount::code),
    ("AuthTxFeeCollector", AuthTxFeeCollector::code),
    ("SchemaCommitment", AccountSchemaCommitment::code),
    ("Pausable", Pausable::code),
    ("PausableManager", PausableManager::code),
    ("UpgradeManager", UpgradeManager::code),
    ("PriceOracle", PriceOracle::code),
    ("BasicConstantFeePolicy", BasicConstantFeePolicy::code),
    ("ConstantFeeManager", ConstantFeeManager::code),
    ("TokenPolicyManager", TokenPolicyManager::code),
    ("TokenPolicyManagerV2", TokenPolicyManagerV2::code),
    ("MintAllowAll", MintAllowAll::code),
    ("MintOwnerOnly", MintOwnerOnly::code),
    ("BurnAllowAll", BurnAllowAll::code),
    ("BurnOwnerOnly", BurnOwnerOnly::code),
    ("MinBurnAmount", MinBurnAmount::code),
    ("TransferAllowAll", TransferAllowAll::code),
    ("BasicAllowlist", BasicAllowlist::code),
    ("AllowlistManager", AllowlistManager::code),
    ("BasicBlocklist", BasicBlocklist::code),
    ("BlocklistManager", BlocklistManager::code),
];

/// A standard component detected in an account, with the procedures it claims.
#[derive(Debug, PartialEq, Eq)]
pub struct StandardComponent {
    pub name: &'static str,
    pub procedures: Vec<AccountProcedureRoot>,
}

/// What an account's procedures are made of: the standard components
/// detected, and the procedures none of them claims, the account's custom
/// code.
#[derive(Debug)]
pub struct Classification {
    pub standard: Vec<StandardComponent>,
    pub custom: BTreeSet<AccountProcedureRoot>,
}

/// Classifies an account's procedures: a component is detected when every one
/// of its procedures is still unclaimed, and it then claims them, as
/// upstream's per-component step (private to the crate) does.
pub fn classify(procedures: &[AccountProcedureRoot]) -> Classification {
    let mut custom = BTreeSet::from_iter(procedures.iter().copied());
    let mut standard = Vec::new();
    for (name, code) in STANDARD_COMPONENTS {
        let roots: Vec<_> = code().procedure_roots().collect();
        if roots.iter().all(|root| custom.contains(root)) {
            for root in &roots {
                custom.remove(root);
            }
            standard.push(StandardComponent {
                name,
                procedures: roots,
            });
        }
    }
    Classification { standard, custom }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots(code: ComponentCode) -> Vec<AccountProcedureRoot> {
        code().procedure_roots().collect()
    }

    /// A component listed after one whose procedures are all among its own
    /// would never be detected: the earlier one would claim them first.
    #[test]
    fn standard_components_claim_in_order() {
        for (index, (earlier, earlier_code)) in STANDARD_COMPONENTS.iter().enumerate() {
            let earlier_roots = BTreeSet::from_iter(roots(*earlier_code));
            for (later, later_code) in &STANDARD_COMPONENTS[index + 1..] {
                let later_roots = BTreeSet::from_iter(roots(*later_code));
                assert!(
                    !earlier_roots.is_subset(&later_roots),
                    "{later} holds every procedure of {earlier}, so it must come first",
                );
            }
        }
    }

    /// Each component alone is detected as itself, claiming all its procedures.
    #[test]
    fn detects_each_standard_component() {
        for (name, code) in STANDARD_COMPONENTS {
            let procedures = roots(*code);
            let classification = classify(&procedures);
            assert_eq!(
                classification.standard,
                vec![StandardComponent { name, procedures }],
                "{name}",
            );
            assert!(classification.custom.is_empty(), "{name}");
        }
    }

    /// The fourteen components upstream detects, it detects alone as the
    /// import does, under the same names: its variants'.
    #[test]
    fn agrees_with_upstream() {
        use miden_standards::account::interface::{
            AccountComponentInterface, AccountComponentInterfaceExt,
        };
        let mut agreed = 0;
        for (name, code) in STANDARD_COMPONENTS {
            let upstream: Vec<_> = AccountComponentInterface::from_procedures(&roots(*code))
                .into_iter()
                .filter(|component| {
                    !matches!(
                        component,
                        AccountComponentInterface::Custom(_)
                            | AccountComponentInterface::CustomAuth(_)
                    )
                })
                .map(|component| format!("{component:?}"))
                .collect();
            match upstream.as_slice() {
                [] => {}
                [upstream] => {
                    assert_eq!(upstream, name);
                    agreed += 1;
                }
                _ => panic!("upstream detects {upstream:?} in {name}"),
            }
        }
        assert_eq!(agreed, 14);
    }

    /// The list names every account component package of the copy of the
    /// crate's MASM, which `sync-miden-standards` keeps at the crate's version
    /// and which runs this test after every sync.
    #[test]
    fn lists_every_standard_component() {
        let components = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../miden-standards/asm/components");
        let read = |path: std::path::PathBuf| -> toml::Table {
            std::fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
                .parse()
                .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
        };
        let workspace = read(components.join("miden-project.toml"));
        let members = workspace["workspace"]["members"]
            .as_array()
            .expect("members");
        let shipped: BTreeSet<String> = members
            .iter()
            .map(|member| {
                let manifest = read(
                    components
                        .join(member.as_str().expect("member"))
                        .join("miden-project.toml"),
                );
                manifest["package"]["name"]
                    .as_str()
                    .expect("package name")
                    .to_string()
            })
            .collect();
        let listed: BTreeSet<String> = STANDARD_COMPONENTS
            .iter()
            .map(|(_, code)| code().as_package().name.to_string())
            .collect();
        assert_eq!(listed, shipped);
    }
}
