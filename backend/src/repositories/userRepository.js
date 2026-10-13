import bcrypt from 'bcryptjs';

const SEED = [
  { email: 'admin@pureinsights.demo', name: 'Ada Admin', role: 'admin' },
  { email: 'analyst@pureinsights.demo', name: 'Ana Analyst', role: 'analyst' },
  { email: 'viewer@pureinsights.demo', name: 'Vik Viewer', role: 'viewer' },
];

/** In-memory user store with bcrypt-hashed seeded demo users (resets on restart; documented limitation). */
export class UserRepository {
  constructor(demoPassword) {
    const hash = bcrypt.hashSync(demoPassword, 8);
    this.users = SEED.map((u, i) => ({ id: `U-${i + 1}`, ...u, passwordHash: hash, active: true }));
  }

  findByEmail(email) {
    return this.users.find((u) => u.email === email.trim().toLowerCase());
  }

  findById(id) {
    return this.users.find((u) => u.id === id);
  }

  list() {
    return this.users.map(UserRepository.toPublic);
  }

  update(id, patch) {
    const user = this.findById(id);
    if (!user) return null;
    Object.assign(user, patch);
    return UserRepository.toPublic(user);
  }

  static toPublic({ passwordHash: _omit, ...rest }) {
    return rest;
  }
}
