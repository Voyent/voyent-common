var crypto = require('crypto');
var bcrypt = require('bcrypt-nodejs');
var SALT_WORK_FACTOR = 10;

function encrypt(text, salt) {
    var cipher = crypto.createCipher('aes-256-cbc', salt);
    cipher.update(text, 'utf8', 'base64');
    var encryptedText = cipher.final('base64');
    return encryptedText;
}

function decrypt(text, salt) {
    var decipher = crypto.createDecipher('aes-256-cbc', salt);
    decipher.update(text, 'base64', 'utf8');
    var decryptedText = decipher.final('utf8');
    return decryptedText;
}

function bcryptionSync(text) {
    var salt = bcrypt.genSaltSync(SALT_WORK_FACTOR);
    var bcryptedHash = bcrypt.hashSync(text, salt);
    return bcryptedHash;
}

function bcompareSync(text, hash) {
    return bcrypt.compareSync(text, hash);
}

function bcryption(text) {

    //Generate salt for the hash
    bcrypt.genSalt(SALT_WORK_FACTOR, function (err, salt) {

        if (err) {
            throw err;
        }

        //Async
        bcrypt.hash(text, salt, function (err, hash) {

            if (err) {
                throw err;
            }

            return hash;
        });
    });

}

exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.bcryptionSync = bcryptionSync;
exports.bcryption = bcryption;
exports.bcompareSync = bcompareSync;
