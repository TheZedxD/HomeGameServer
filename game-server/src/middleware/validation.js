const { body, validationResult } = require('express-validator');

const validateSignup = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 24 })
        .matches(/^[a-zA-Z0-9_-]+$/)
        .withMessage('Username must be 3-24 characters, letters/numbers/underscore/hyphen only'),
    body('displayName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 24 }),
    body('password')
        .isLength({ min: 12 })
        .withMessage('Password must be at least 12 characters'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

module.exports = { validateSignup };
