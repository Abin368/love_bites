import { Op, Transaction } from 'sequelize';
import '../../database/associations';
import { UserCreditBalance } from '../../database/models/user-credit-balance.model';
import type { StoredCreditBalances } from './entitlements.types';

const SUPER_LIKE_CREDIT = 'SUPER_LIKE';
const BOOST_CREDIT = 'BOOST';

export async function findStoredCreditBalances(
  userId: string,
  transaction: Transaction
): Promise<StoredCreditBalances> {
  const rows = await UserCreditBalance.findAll({
    attributes: ['creditType', 'balance'],
    where: {
      userId,
      creditType: { [Op.in]: [SUPER_LIKE_CREDIT, BOOST_CREDIT] }
    },
    transaction
  });

  const balances: StoredCreditBalances = {
    boostBalance: 0,
    superLikeBalance: 0
  };

  for (const row of rows) {
    const balance = Number(row.balance);
    if (row.creditType === SUPER_LIKE_CREDIT) {
      balances.superLikeBalance = balance;
    } else if (row.creditType === BOOST_CREDIT) {
      balances.boostBalance = balance;
    }
  }

  return balances;
}
