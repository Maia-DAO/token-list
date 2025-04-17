```md
# Hermes dApp Token Lists Repository

This project automates the fetching, filtering, and merging of token lists from various bridges and protocols.

## 📁 Project Structure

```
output/                  → Contains the token list JSON files.
scripts/                 → Node.js scripts to fetch, filter, and merge token lists.
scripts/cache/           → Temporary or cached data used by scripts.
token-list.json          → The final generated active token list.
inactive-token-list.json → The final generated inactive token list.
```

## 📦 Installation

Before running any scripts, install dependencies using Yarn:

```bash
yarn install
```

## 🧪 Available Scripts

Run individual tasks or the full pipeline using `yarn` commands:

| Script         | Command                                       | Description |
|----------------|-----------------------------------------------|-------------|
| `fetch`        | `yarn fetch`                                  | Fetch external token lists into `output/` directory. |
| `filter`       | `yarn filter`                                 | Filter Stargate and Across tokens for supported chains. |
| `merge`        | `yarn merge`                                  | Merge active token lists into `token-list.json`. |
| `merge-others` | `yarn merge-others`                           | Merge remaining tokens into `inactive-token-list.json`. |
| `all`          | `yarn all`                                    | Run all steps: `fetch` → `filter` → `merge` → `merge-others`. |

## ⚙️ Output Files

After running the pipeline:

- `token-list.json`: Active tokens list (Uniswap-compatible).
- `inactive-token-list.json`: Inactive tokens not used in the main list.

## 📝 Notes

⚠️ **Manual Update Required:** If you need to support new chains in the future, update the hardcoded chain list in `scripts/filterStargateTokens.js`.

## 📆 Automation

This project includes a GitHub Action to run the full workflow every **Wednesday between 11 PM and midnight UTC**, ensuring the lists stay fresh and consistent.
```