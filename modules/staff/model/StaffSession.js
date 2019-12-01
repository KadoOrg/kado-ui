'use strict';
/**
 * Kado - Web Application System
 * Copyright © 2015-2019 Bryan Tong, NULLIVEX LLC. All rights reserved.
 * Kado <support@kado.org>
 *
 * This file is part of Kado and bound to the MIT license distributed within.
 */


/**
 * Exporting the model
 * @param {object} sequelize
 * @param {object} DataTypes
 * @return {object}
 */
module.exports = function(sequelize,DataTypes) {
  return sequelize.define('StaffSession',{
      sid: {
        type: DataTypes.STRING,
        primaryKey: true
      },
      expires: {
        type: DataTypes.DATE
      },
      data: {
        type: DataTypes.TEXT
      }
    },
    {
      indexes: [
        {
          name: 'expires_index',
          method: 'BTREE',
          fields: ['expires']
        },
        {
          name: 'createdAt_index',
          method: 'BTREE',
          fields: ['createdAt']
        },
        {
          name: 'updatedAt_index',
          method: 'BTREE',
          fields: ['updatedAt']
        }
      ]
    })
}
