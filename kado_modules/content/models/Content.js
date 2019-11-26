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
module.exports = (sequelize,DataTypes) => {
  return sequelize.define('Content',{
    title: {
      type: DataTypes.STRING,
      allowNull: false
    },
    uri: {
      type: DataTypes.STRING,
      allowNull: false
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    html: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  },
  {
    indexes: [
      {
        name: 'title_index',
        method: 'BTREE',
        fields: ['title']
      },
      {
        name: 'uri_index',
        method: 'BTREE',
        fields: ['uri']
      },
      {
        name: 'active_index',
        method: 'BTREE',
        fields: ['active']
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
