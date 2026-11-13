import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { dbHelpers, normalizeEmail, withTransaction } from '../database.js'

export const MIN_PASSWORD_LENGTH = 8

const router = express.Router()

// Middleware to get authenticateJWT from app locals
const authenticateJWT = (req, res, next) => {
  return req.app.locals.authenticateJWT(req, res, next)
}

// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body
    
    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ 
        message: 'Name, email, and password are required' 
      })
    }
    
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ 
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long` 
      })
    }
    
    // Email validation
    const normalizedEmail = normalizeEmail(email)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ 
        message: 'Please provide a valid email address' 
      })
    }
    
    const db = req.app.locals.db
    
    // Check if user already exists
    const existingUser = await dbHelpers.getUserByEmail(db, normalizedEmail)
    if (existingUser) {
      return res.status(409).json({ 
        message: 'User with this email already exists' 
      })
    }
    
    // Hash password
    const saltRounds = 12
    const hashedPassword = await bcrypt.hash(password, saltRounds)
    
    // Create user
    const result = await dbHelpers.createUser(db, {
      name: String(name).trim(),
      email: normalizedEmail,
      password: hashedPassword
    })
    
    // Get created user (without password)
    const newUser = await dbHelpers.getUserById(db, result.lastID)
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: newUser.id, 
        email: newUser.email 
      },
      req.app.locals.JWT_SECRET,
      { 
        expiresIn: '7d' 
      }
    )
    
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: newUser
    })
    
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ 
      message: 'Internal server error during registration' 
    })
  }
})

// Login endpoint
router.post('/login', (req, res, next) => {
  const { email, password } = req.body
  
  // Validation
  if (!email || !password) {
    return res.status(400).json({ 
      message: 'Email and password are required' 
    })
  }
  
  req.body.email = normalizeEmail(email)

  req.app.locals.passport.authenticate('local', { session: false }, (err, user, info) => {
    if (err) {
      console.error('Login error:', err)
      return res.status(500).json({ 
        message: 'Internal server error during login' 
      })
    }
    
    if (!user) {
      return res.status(401).json({ 
        message: info?.message || 'Invalid email or password' 
      })
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email 
      },
      req.app.locals.JWT_SECRET,
      { 
        expiresIn: '7d' 
      }
    )
    
    res.json({
      message: 'Login successful',
      token,
      user
    })
    
  })(req, res, next)
})

// Logout endpoint
router.get('/logout', (req, res) => {
  // For JWT-based auth, logout is handled client-side by removing the token
  // But we can still provide an endpoint for consistency
  res.json({ 
    message: 'Logout successful' 
  })
})

// Get current user endpoint
router.get('/me', authenticateJWT, (req, res) => {
  res.json({
    user: req.user
  })
})

// Change password endpoint
router.put('/change-password', authenticateJWT, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        message: 'Current password and new password are required' 
      })
    }
    
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ 
        message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters long` 
      })
    }
    
    const db = req.app.locals.db
    
    // Get user with password
    const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id)
    
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found' 
      })
    }
    
    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password)
    
    if (!isValidPassword) {
      return res.status(401).json({ 
        message: 'Current password is incorrect' 
      })
    }
    
    // Hash new password
    const saltRounds = 12
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds)
    
    // Update password
    await db.run('UPDATE users SET password = ? WHERE id = ?', hashedNewPassword, req.user.id)
    
    res.json({ 
      message: 'Password changed successfully' 
    })
    
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ 
      message: 'Internal server error during password change' 
    })
  }
})

// Update profile endpoint
router.put('/profile', authenticateJWT, async (req, res) => {
  try {
    const { name, email } = req.body
    
    if (!name || !email) {
      return res.status(400).json({ 
        message: 'Name and email are required' 
      })
    }
    
    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(normalizeEmail(email))) {
      return res.status(400).json({ 
        message: 'Please provide a valid email address' 
      })
    }
    
    const db = req.app.locals.db
    
    // Check if email is already taken by another user
    const existingUser = await db.get(
      'SELECT id FROM users WHERE lower(email) = ? AND id != ?',
      normalizeEmail(email), req.user.id
    )
    
    if (existingUser) {
      return res.status(409).json({ 
        message: 'Email is already taken by another user' 
      })
    }
    
    // Update user profile
    await db.run('UPDATE users SET name = ?, email = ? WHERE id = ?', String(name).trim(), normalizeEmail(email), req.user.id)
    
    // Get updated user
    const updatedUser = await dbHelpers.getUserById(db, req.user.id)
    
    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    })
    
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ 
      message: 'Internal server error during profile update' 
    })
  }
})

// Delete account endpoint
router.delete('/account', authenticateJWT, async (req, res) => {
  try {
    const { password } = req.body
    
    if (!password) {
      return res.status(400).json({ 
        message: 'Password is required to delete account' 
      })
    }
    
    const db = req.app.locals.db
    
    // Get user with password
    const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id)
    
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found' 
      })
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password)
    
    if (!isValidPassword) {
      return res.status(401).json({ 
        message: 'Password is incorrect' 
      })
    }
    
    // Fase 5A: delete the user and everything they own (share links,
    // versions, projects) explicitly, in one transaction.
    await withTransaction(db, () => dbHelpers.deleteUserCascade(db, req.user.id))
    
    res.json({ 
      message: 'Account deleted successfully' 
    })
    
  } catch (error) {
    console.error('Delete account error:', error)
    res.status(500).json({ 
      message: 'Internal server error during account deletion' 
    })
  }
})

// Verify token endpoint
router.post('/verify-token', async (req, res) => {
  const { token } = req.body
  
  if (!token) {
    return res.status(400).json({ 
      message: 'Token is required' 
    })
  }
  
  try {
    const decoded = jwt.verify(token, req.app.locals.JWT_SECRET)
    const db = req.app.locals.db
    
    // Get user to ensure they still exist
    const user = await dbHelpers.getUserById(db, decoded.id)
    
    if (!user) {
      return res.status(401).json({ 
        message: 'Invalid token - user not found' 
      })
    }
    
    res.json({
      valid: true,
      user
    })
    
  } catch (error) {
    res.status(401).json({ 
      valid: false,
      message: 'Invalid or expired token'
    })
  }
})

export default router