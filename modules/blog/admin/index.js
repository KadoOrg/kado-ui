'use strict';
/**
 * Kado - Web Application System
 * Copyright © 2015-2019 Bryan Tong, NULLIVEX LLC. All rights reserved.
 * Kado <support@kado.org>
 *
 * This file is part of Kado and bound to the MIT license distributed within.
 */
const P = require('bluebird')
const K = require('kado').getInstance()
const base64 = require('base64-js')
const crypto = require('crypto')
const datatable = require('sequelize-datatable')
const datatableView = require(K.lib('datatableView'))
const tuiEditor = require(K.lib('tuiEditor'))
const sequelize = K.db.sequelize
const Blog = sequelize.models.Blog
const BlogRevision = sequelize.models.BlogRevision


/**
 * List blogs
 * @param {object} req
 * @param {object} res
 */
exports.list = (req,res) => {
  if(!req.query.length){
    datatableView(res)
    res.render('blog/list',{_pageTitle: K._l.blog.blog + ' ' + K._l.list})
  } else {
    datatable(Blog,req.query,res.Q)
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
  res.locals._asset.addScriptOnce('/blog/static/create.js','defer')
  res.render('blog/create',{_pageTitle: K._l.blog.blog + ' ' + K._l.create})
}


/**
 * Edit
 * @param {object} req
 * @param {object} res
 */
exports.edit = (req,res) => {
  tuiEditor(res)
  res.locals._asset.addScriptOnce('/blog/static/edit.js')
  let q = res.Q
  q.include = [{model: BlogRevision}]
  Blog.findByPk(req.query.id,q)
    .then((result) => {
      if(!result) throw new Error(K._l.blog_entry_not_found)
      result.content = base64.fromByteArray(Buffer.from(result.content,'utf-8'))
      res.render('blog/edit',{
        blog: result, _pageTitle: K._l.edit + ' ' + K._l.blog.blog})
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
  let blog
  let isNewRevision = false
  let isNew = false
  let json = K.isClientJSON(req)
  Blog.findByPk(data.id)
    .then((result) => {
      blog = result
      if(!blog){
        isNew = true
        blog = Blog.build({
          content: '',
          html: ''
        })
      }
      if(data.title) blog.title = data.title
      if(data.uri) blog.uri = data.uri
      if('undefined' === typeof data.active) blog.active = false
      if(data.active) blog.active = true
      //first hash them
      if(!data.content) data.content = ''
      if(!data.html) data.html = ''
      let cipher = crypto.createHash('sha256')
      hash = cipher.update(data.content + data.html).digest('hex')
      return BlogRevision.findOne({where: {hash: hash, BlogId: blog.id}})
    })
    .then((result) => {
      if(!result){
        isNewRevision = true
        let revParams = {
          content: data.content,
          html: data.html,
          hash: hash,
          BlogId: blog.id
        }
        return BlogRevision.create(revParams)
      } else {
        return result
      }
    })
    .then(() => {
      blog.content = data.content
      blog.html = data.html
      return blog.save()
    })
    .then((blog) => {
      if(json){
        res.json({blog: blog.dataValues})
      } else {
        req.flash('success',{
          message: K._l.blog.blog_entry + ' ' +
            (isNew ? K._l.created : K._l.saved),
          href: '/blog/edit?id=' + blog.id,
          name: blog.id
        })
        res.redirect('/blog/list')
      }
    })
    .catch((err) => {
      if(json){
        res.json({error: err.message})
      } else {
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
      return id > 0 ? Blog.destroy(id) : null
    })
    .then(() => {
      if(json){
        res.json({success: K._l.blog.blog_removed})
      } else {
        req.flash('success',K._l.blog.blog_removed)
        res.redirect('/blog/list')
      }
    })
    .catch((err) => {
      if(json){
        res.json({error: err.message || K._l.blog.blog_removal_error})
      } else {
        res.render('error',{error: err.message})
      }
    })
}


/**
 * Revert Blog to previous version
 * @param {object} req
 * @param {object} res
 */
exports.revert = (req,res) => {
  let revision
  let blog
  let data = req.body
  BlogRevision.findByPk(data.revisionId)
    .then((result)=>{
      revision = result
      if(!revision) throw new Error('Revision Not Found')
      return Blog.findByPk(data.blogId)
        .then((result)=>{
          blog= result
          if(!blog) throw new Error('Blog Not Found')
          return blog
      })
    })
    .then(()=>{
      blog.content = revision.content
      blog.html = revision.html
      revision.save()
      return blog.save()
    })
    .then(() => {
      res.json({
        status: 'ok',
        message: 'Blog Reverted',
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