// Network adapter stub (Firewalla later)

export async function unlockKid({ kidId, minutes, targets }) {
  console.log(
    "[NETWORK] unlockKid",
    JSON.stringify({ kidId, minutes, targets }, null, 2)
  );
}

export async function lockKid({ kidId, targets }) {
  console.log(
    "[NETWORK] lockKid",
    JSON.stringify({ kidId, targets }, null, 2)
  );
}
