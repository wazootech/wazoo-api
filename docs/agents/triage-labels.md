# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Category labels

Categories are separate from the state above, and every triaged issue should carry exactly one of them:

| Category    | Label         |
| ----------- | ------------- |
| `bug`       | `bug`         |
| `enhancement` | `enhancement` |

Both already exist in this tracker as GitHub defaults. Note that `wontfix` is also a GitHub default label — reuse it rather than creating a second one.

A decision or proposal issue fits neither `bug` nor `enhancement`. Record it as `needs-triage` and leave it unlabeled by category rather than mislabelling it; a maintainer decides what it becomes.