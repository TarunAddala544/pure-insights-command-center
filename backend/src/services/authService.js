import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { unauthorized } from '../utils/errors.js';

export class AuthService {
  constructor({ users, cfg, audit }) {
    this.users = users;
    this.cfg = cfg;
    this.audit = audit;
  }

  async login(email, password) {
    const user = this.users.findByEmail(email);
    // Same error for unknown user, bad password and disabled account: no account enumeration.
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
      this.audit.record(email, 'auth.login_failed', email);
      throw unauthorized('Invalid credentials');
    }
    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, this.cfg.jwtSecret, { expiresIn: this.cfg.jwtExpiresIn });
    this.audit.record(user.email, 'auth.login', user.id);
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }
}
