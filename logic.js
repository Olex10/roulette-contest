export function chipsFor(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw Error('Неверная сумма');
  }

  if (amount > 10000) {
    return Math.floor(amount / 100);
  }

  return (
    15 +
    Math.floor(Math.max(0, Math.min(amount, 5000) - 1000) / 200) +
    3 * Math.floor(Math.max(0, amount - 5000) / 200)
  );
}

export function outcome(number) {
  return number === 0
    ? 'zero'
    : [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(number)
      ? 'red'
      : 'black';
}

export function payout(stake, choice, result) {
  return choice === result
    ? stake * (result === 'zero' ? 3 : 2)
    : 0;
}
