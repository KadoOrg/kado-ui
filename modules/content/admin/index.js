'use strict';
/**
 * Kado - Web Application System
 * Copyright © 2015-2019 Bryan Tong, NULLIVEX LLC. All rights reserved.
 * Kado <support@kado.org>
 *
 * This file is part of Kado and bound to the MIT license distributed within.
 */
const K = require('kado').getInstance()
const base64 = require('base64-js')
const crypto = require('crypto')
const datatable = require('sequelize-datatable')
const datatableView = require(K.lib('datatableView'))
const tuiEditor = require(K.lib('tuiEditor'))
const sequelize = K.db.sequelize

const Content = sequelize.models.Content
const ContentRevision = sequelize.models.ContentRevision


/**
 * Chain load into nav manager
 */
exports.nav = require('./nav')


/**
 * List content
 * @param {object} req
 * @param {object} res
 */
exports.list = (req,res) => {
  if(!req.query.length){
    datatableView(res)
    res.render('content/list',{
      _pageTitle: K._l.content.content + ' ' + K._l.list})
  } else {
    datatable(Content,req.query)
      .then((result) => {
        res.json(result)
      })
      .catch((err) => {
        res.json({error: err.message})
      })
  }
}


/**
 * Create entry
 * @param {object} req
 * @param {object} res
 */
exports.create = (req,res) => {
  res.locals._asset.addScriptOnce('/js/util.js','defer')
  res.locals._asset.addScriptOnce('/content/static/create.js','defer')
  res.render('content/create',{
    _pageTitle: K._l.content.content + ' ' + K._l.create})
}


/**
 * Edit
 * @param {object} req
 * @param {object} res
 */
exports.edit = (req,res) => {
  tuiEditor(res)
  res.locals._asset.addScriptOnce('/content/static/edit.js','defer')
  res.locals._asset.addScriptOnce('/content/static/revertContent.js','defer')
  let q = res.Q
  q.include = [{model: ContentRevision}]
  Content.findByPk(req.query.id,q)
    .then((result) => {
      if(!result) throw new Error(K._l.content_entry_not_found)
      result.content = base64.fromByteArray(Buffer.from(result.content,'utf-8'))
      res.render('content/edit',{
        content: result,
        _pageTitle: K._l.edit + ' ' + K._l.content.content + ' ' + result.title
      })
    })
    .catch((err) => {
      res.render('error',{error: err})
    })
}


/**
 * Save
 * @param {object} req
 * @param {object} res
 */
exports.save = (req,res) => {
  let data = req.body
  let hash
  let content
  let isNewRevision = false
  let isNew = false
  let json = K.isClientJSON(req)
  Content.findByPk(data.id)
    .then((result) => {
      content = result
      if(!content){
        isNew = true
        content = Content.build({
          content: '',
          html: ''
        })
      }
      if(data.title) content.title = data.title
      if(data.uri) content.uri = data.uri
      if('undefined' === typeof data.active) content.active = false
      if(data.active) content.active = true
      //first hash them
      if(!data.content) data.content = ''
      if(!data.html) data.html = ''
      let cipher = crypto.createHash('sha256')
      hash = cipher.update(data.content + data.html).digest('hex')
      return ContentRevision.findOne({where: {
          hash: hash, ContentId: content.id}})
    })
    .then((result) => {
      if(!result){
        isNewRevision = true
        let revParams = {
          content: data.content,
          html: data.html,
          hash: hash,
          ContentId: content.id
        }
        return ContentRevision.create(revParams)
      } else {
        return result
      }
    })
    .then(() => {
      content.content = data.content
      content.html = data.html
      return content.save()
    })
    .then((content) => {
      if(json){
        res.json({content: content.dataValues})
      } else {
        req.flash('success',{
          message: K._l.content.content_entry + ' ' +
            (isNew ? K._l.created : K._l.saved),
          href: '/content/edit?id=' + content.id,
          name: content.id
        })
        res.redirect('/content/list')
      }
    })
    .catch((err) => {
      if(json){
        res.json({error: err.message})
      } else {
        console.log(err)
        res.render('error',{error: err})
      }
    })
}


/**
 * Process removals
 * @param {object} req
 * @param {object} res
 */
exports.remove = (req,res) => {
  let json = K.isClientJSON(req)
  if(req.query.id) req.body.remove = req.query.id.split(',')
  if(!(req.body.remove instanceof Array)) req.body.remove = [req.body.remove]
  P.try(()=>{return req.body.remove})
    .each((id)=>{
      return id > 0 ? Content.destroy({where: {id: id}}) : null
    })
    .then(() => {
      if(json){
        res.json({success: K._l.content.content_removed})
      } else {
        req.flash('success',K._l.content.content_removed)
        res.redirect('/content/list')
      }
    })
    .catch((err) => {
      if(json){
        res.json({error: err.message || K._l.content.content_removal_error})
      } else {
        res.render('error',{error: err.message})
      }
    })
}


/**
 * Revert Content to previous version
 * @param {object} req
 * @param {object} res
 */
exports.revert = (req,res) => {
  let revision
  let content
  let data = req.body
  ContentRevision.findByPk(data.revisionId)
    .then((result)=>{
      revision = result
      if(!revision) throw new Error('Revision Not Found')
      return Content.findByPk(data.contentId)
        .then((result)=>{
          content= result
          if(!content) throw new Error('Content Not Found')
          return content
        })
    })
    .then(()=>{
      content.content = revision.content
      content.html = revision.html
      revision.save()
      return content.save()
    })
    .then(() => {
      res.json({
        status: 'ok',
        message: 'Content Reverted',
      })
    })
    .catch((err) => {
      res.status(500)
      res.json({
        status: 'error',
        message: err.message
      })
    })
}