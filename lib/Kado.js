'use strict';
/**
 * Kado - Web Application System
 * Copyright © 2015-2019 Bryan Tong, NULLIVEX LLC. All rights reserved.
 * Kado <support@kado.org>
 *
 * This file is part of Kado and bound to the MIT license distributed within.
 */
const debug = require('debug')('kado:core')
const express = require('express')
const fs = require('fs')
const http = require('http')
const mustache = require('mustache')
const ObjectManage = require('object-manage')
const pkg = require('../package.json')
const path = require('path')
const serveStatic = require('serve-static')

//singleton storage
let instance = null

function getCurrentNodeMethods(){
  return http.METHODS && http.METHODS.map(function lowerCaseMethod(method) {
    return method.toLowerCase();
  });
}

module.exports = class Kado {
  static getInstance(){ return instance }
  constructor(config,configLocal){
    //NOTE: The loading order is very IMPORTANT!
    //load and expose our sub systems
    this.Asset = require('kado/lib/Asset')
    this.CommandServer = require('kado/lib/CommandServer')
    this.Config = require('./Config')
    this.Connector = require('kado/lib/Connector')
    this.Cron = require('kado/lib/Cron')
    this.Database = require('kado/lib/Database')
    this.Email = require('kado/lib/Email')
    this.Event = require('kado/lib/Event')
    this.History = require('kado/lib/History')
    this.Language = require('kado/lib/Language')
    this.Library = require('kado/lib/Library')
    this.Logger = require('kado/lib/Logger')
    this.LoggerWinston = require('./LoggerWinston')
    this.Message = require('kado/lib/Message')
    this.Navigation = require('kado/lib/Navigation')
    this.Permission = require('kado/lib/Permission')
    this.Profiler = require('kado/lib/Profiler')
    this.Router = require('kado/lib/Router')
    this.Search = require('kado/lib/Search')
    this.Util = require('kado/lib/Util')
    this.View = require('kado/lib/View')
    this.express = express()
    this.config = new ObjectManage()
    this.envConfigLoaded = false
    this.logger = new this.Logger()
    this.log = new this.LoggerWinston().getLog()
    this.determinePaths()
    this.loadDefaultConfig()
    this.setDevMode()
    this.saveOriginalConfig()
    this.asset = new this.Asset()
    this.breadcrumb = new this.History()
    this.cli = new this.CommandServer(this)
    this.connector = new this.Connector()
    this.cron = new this.Cron()
    this.database = new this.Database()
    this.db = {}
    this.email = new this.Email()
    this.event = new this.Event()
    this.lang = new this.Language()
    this.library = new this.Library()
    this.message = new this.Message()
    this.modules = {}
    this.nav = new this.Navigation()
    this.permission = new this.Permission()
    this.router = new this.Router()
    this.search = new this.Search()
    this.util = new this.Util()
    this.version = pkg.version
    this.view = new this.View()
    this.loadEnvConfig()
    this.config.$load(config)
    if(configLocal) this.config.$load(configLocal)
    this.loadLoggers()
    this.loadLibrary()
    this.loadConnector()
    this.loadDatabase()
    this.loadEmail()
    this.loadScriptServers()
    this.loadSession()
    this.loadExpress()
    this.loadAuthentication()
    if(this.config.autoSaveInstance) this.setInstance(this)
    this.loadModules()
    this.loadModels()
    this.loadLanguagePacks()
    this.loadModuleInstance()
    this.loadViews()
    this.loadSearch()
    this.loadRendering()
    this.loadStaticServer()
  }
  //UTILITY FUNCTIONS
  addModule(moduleRoot){
    const mod = require(moduleRoot)
    mod._kado.root = path.dirname(moduleRoot)
    const libRoot = path.resolve(path.join(mod._kado.root,'lib'))
    if(fs.existsSync(libRoot)) this.library.addPath(libRoot)
    if('function' === typeof mod.config) mod.config(this)
    if('function' === typeof mod.db) mod.db(this)
    if('function' === typeof mod.cli) mod.cli(this)
    this.modules[mod._kado.name] = mod
  }
  configure(conf){
    this.config.$load(conf)
    return this.config
  }
  determinePaths(){
    this.KADO_ROOT = path.dirname(__dirname)
    this.KADO_USER_ROOT = path.dirname(path.dirname(this.KADO_ROOT))
    const userPackageJson = path.resolve(
      path.join(this.KADO_USER_ROOT,'package.json')
    )
    if(!fs.existsSync(userPackageJson)) this.KADO_USER_ROOT = this.KADO_ROOT
    this.INTERFACE_ROOT = path.resolve(
      path.join(this.KADO_USER_ROOT,this.config.instanceName || 'main'))
  }
  flashHandler(req){
    return () => {
      return (text) => {
        let parts = text.split(',')
        if(parts.length > 2){
          throw new Error('Failure to parse alert template')
        }
        let level = parts[0],tpl = parts[1],out = ''
        let messages = req.flash(level)
        if(messages && messages.length){
          messages.map((message) => {
            if(message && message.message && message.href){
              message = message.message +
                '&nbsp; [<a href="' + message.href + '">' +
                (message.name || message.id || 'Click') + '</a>]'
            }
            else if(message && message.message){
              message = message.message
            }
            let msg = '      ' + tpl
            msg = msg.replace('{{level}}',level)
            msg = msg.replace('{{alert}}',message)
            out = out + msg
          })
        }
        return out
      }
    }
  }
  getModule(name){
    return this.modules[name]
  }
  isClientJSON(req){
    let accept = req.get('accept') || ''
    return (req.query.json || accept.match('application/json'))
  }
  lib(name){
    if(!name) throw new Error('Helper required without a name')
    return this.library.search(name)
  }
  removeModule(name){
    delete this.modules[name]
    return name
  }
  /**
   * Define our own render function to handle view lookups
   *  as well as profiling
   * @param {string} tpl Such as blog/list when absolute ignores lookup
   * @param {object} options Same object passed to normal render
   * @param {function} cb Optional callback which will be called instead
   *  of sending the data automatically
   */
  render(tpl,options,cb){
    const that = this
    //apply system resources
    if(this.locals._asset){
      this.locals._css = this.locals._asset.all('text/css')
      this.locals._script = this.locals._asset.all('text/javascript')
    }
    //start the rendering timer
    if(this.locals && this.locals._profiler){
      this.locals._profiler.startRender()
    }
    //check if we should try and lookup the view
    if(!(tpl[0] === '/' || tpl[2] === '\\')){
      tpl = this.locals._view.get(tpl)
    }
    if(!options) options = {}
    this._render(tpl,options,(err,output)=>{
      if(!err && output){
        output = mustache.render(output,{
          _pageProfile: that.locals._profiler.build(pkg.version)
        },null,['<%','%>'])
      }
      if(cb){
        return cb(err,output)
      } else {
        if(err){
          that.status(500)
          that.send({error: err.message})
        } else {
          that.send(output)
        }
      }
    })
  }
  saveOriginalConfig(){
    this.originalConfig = ObjectManage.$clone(this.config)
  }
  setDevMode(){
    //set dev mode if debug is turned on and the dev option is null
    if(null === this.config.dev &&
      (process.env.NODE_DEBUG === 'kado' || process.env.DEV === 'kado')
    ){
      process.env.NODE_DEBUG = 'kado'
      this.config.dev = true
    }
  }
  setInstance(inst){
    instance = inst
    return instance
  }
  setupScriptServer(name,scriptPath){
    if(!scriptPath) scriptPath = name
    //try for a local path first and then a system path as a backup
    let ourScriptPath = path.resolve(
      path.join(this.KADO_ROOT,'..','..','node_modules',scriptPath))
    //fall back to a local path if we must
    if(!fs.existsSync(ourScriptPath)){
      ourScriptPath = path.resolve(
        path.join(this.KADO_ROOT,'node_modules',scriptPath))
    }
    if(!fs.existsSync(ourScriptPath) && 'kado' !== name){
      console.log('falling back2',ourScriptPath)
    }
    this.express.use('/node_modules/' + name,serveStatic(
      ourScriptPath,this.express.staticOptions))
  }
  //BOOT FUNCTIONS (Order matches constructor)
  loadDefaultConfig(){
    this.config = new this.Config()
  }
  loadEnvConfig(){
    //load any config left in the env for us
    if(!this.envConfigLoaded && process.env.KADO_CONFIG_STRING){
      try {
        let configDelta = JSON.parse(process.env.KADO_CONFIG_STRING)
        debug('Adding found environment config')
        this.configure(configDelta)
        this.envConfigLoaded = true
      } catch(e){
        exports.log.warn('Failed to load env config: ' + e.message)
      }
    }
  }
  loadLoggers(){
    const that = this
    const logName = process.pid + '-' + this.config.name
    //good morning code, i guess a little warm up to get into typing and to
    //figure out what is going to be the best plan of action today with coding.
    //first there needs to be some code here to load and activate the log
    //handlers, second the UI needs to add a helper to spin up the test
    //interface for running tests using `node app test` and then try to get
    //the tests passing on magic
    //okay lets get started
    Object.keys(this.config.log).forEach((logKey) => {
      if(
        logKey === 'dateFormat' ||
        !(that.config.log[logKey] instanceof Object) ||
        !that.config.log[logKey].root ||
        !fs.existsSync(that.config.log[logKey].root)
      ) return
      const LogHelper = require(that.config.log[logKey].root)
      const logger = new LogHelper(logName,that.config.log[logKey])
      that.logger.addHandler(logKey,logger)
      if(that.config.log[logKey].default === true){
        that.logger.activateHandler(logKey)
      }
    })
    //now that is complete replace the default logger with the active one
    const logHelper = that.logger.getLogger()
    if(logHelper){
      const logger = logHelper.getLog()
      if(logger) this.log = logger
    }
  }
  loadLibrary(){
    this.library.addPath(path.resolve(this.KADO_USER_ROOT + '/lib'))
    this.library.addPath(path.resolve(this.KADO_ROOT + '/lib'))
    if(!this.config.libraryPaths) this.config.libraryPaths = []
    const that = this
    this.config.libraryPaths.forEach((p) => {
      that.library.addPath(p)
    })
    if(!this.config.library) this.config.library = []
    this.config.library.forEach((p) => {
      that.library.add(p.name,p.file)
    })
    if(!this.config.override.libraryPaths) this.config.override.libraryPaths = []
    this.config.override.libraryPaths.forEach((p) => {
      that.library.addPath(p)
    })
    if(!this.config.override.library) this.config.override.library = []
    this.config.override.library.forEach((p) => {
      that.library.add(p.name,p.file)
    })
  }
  loadConnector(){
    const that = this
    Object.keys(this.config.connector).forEach((connectorName)=>{
      let connectorConfig = this.config.connector[connectorName]
      if(connectorConfig.load === true){
        let ThisConnector = require(connectorConfig.root)
        that.connector.addConnector(
          connectorName,
          new ThisConnector(connectorConfig)
        )
      }
    })
  }
  loadDatabase(){
    const that = this
    Object.keys(this.config.db).forEach((databaseName)=>{
      if(databaseName === 'modelInit') return
      let databaseConfig = this.config.db[databaseName]
      if(databaseConfig.load === true && databaseConfig.enabled === true){
        let ThisDatabase = require(databaseConfig.root)
        let thisDb = new ThisDatabase(databaseConfig)
        that.db[databaseName] = thisDb.get()
        that.database.addDatabase(databaseName,thisDb)
      }
    })
  }
  loadEmail(){
    const that = this
    Object.keys(this.config.email).forEach((emailName)=>{
      let emailConfig = this.config.email[emailName]
      if(emailConfig.load === true){
        let ThisEmail = require(emailConfig.root)
        that.email.addHandler(
          emailName,
          new ThisEmail(emailConfig)
        )
      }
    })
  }
  loadScriptServers(){
    if(!this.config.scriptServer) this.config.scriptServer = []
    const that = this
    this.config.scriptServer.forEach((name)=>{
      that.setupScriptServer(name)
    })
  }
  loadSession(){
    if(!this.config.session.enabled) return
    const cookieParser = require('cookie-parser')
    const expressSession = require('express-session')
    const nocache = require('nocache')
    const SequelizeStore = require('connect-session-sequelize')(
      expressSession.Store)
    const store = new SequelizeStore({
      db: this.db.sequelize,
      table: this.config.session.tableModel || null
    })
    if(this.config.session.tableModel === null) store.sync()
    this.express.use(nocache())
    this.express.use(cookieParser(this.config.session.cookie.secret))
    //session setup
    this.express.use(expressSession({
      cookie: {
        maxAge: this.config.session.cookie.maxAge
      },
      resave: true,
      saveUninitialized: true,
      store: store,
      secret: this.config.session.cookie.secret
    }))
    //setup connect-flash if needed
    if(this.config.session.enableFlash){
      let flash = require('connect-flash')
      this.express.use(flash())
      this.express.use((req,res,next) => {
        res.locals.flash = this.flashHandler(req)
        next()
      })
    }
  }
  loadExpress(){
    const bodyParser = require('body-parser')
    const compress = require('compression')
    const locale = require('locale')
    const that = this
    //enable proxy senders
    this.express.set('trust proxy',true)
    //configure static server
    this.express.staticOptions = {
      cacheControl: true,
      immutable: true,
      index: false,
      maxAge: 14400
    }
    this.express.locals._basedir = this.express.get('views')
    this.express.locals._appName = this.config.name
    this.express.locals._appTitle = this.config.title
    this.express.locals._version = this.config.version
    this.express.locals._moment = require('moment')
    this.express.locals._currentYear =
      this.express.locals._moment().format('YYYY')
    //expose translation systems
    this.express.locals._asset = this.asset
    this.express.locals._breadcrumb = this.breadcrumb
    this.express.locals._dev = this.config.dev
    this.express.locals._nav = this.nav
    this.express.locals._uri = this.router
    this.express.locals._util = this.util
    this.express.locals._view = this.view
    //load profiler and templating override, determine json receiver
    this.express.use((req,res,next)=>{
      //start the profiler and track the page conception time
      const profiler = new this.Profiler()
      res.locals._profiler = profiler
      res.Q = that.database.queryOptions(that.config,profiler)
      res._render = res.render
      res.render = that.render.bind(res)
      res.isJSON = that.isClientJSON(req)
      next()
    })
    //log request in devs
    if(this.config.dev){
      this.express.use(require('morgan')('dev'))
    }
    //load middleware
    this.express.use(compress())
    this.express.use(bodyParser.urlencoded({extended: true}))
    this.express.use(bodyParser.json())
    //system middleware
    this.express.use((req,res,next) => {
      //add breadcrumb links
      that.breadcrumb.crumbs = that.breadcrumb.middleware(that,req)
      //expose system varss
      res.locals._asset = that.asset
      res.locals._breadcrumb = that.breadcrumb
      res.locals._permission = that.permission
      res.locals._uri = that.router
      res.locals._view = that.view
      res.locals._currentUri = req.originalUrl
      //search query
      res.locals._searchPhrase = req.query.searchPhrase || ''
      //set a default _pageTitle
      if(that.config.pageTitle){
        res.locals._pageTitle = mustache.render(
          that.config.pageTitle,res.locals)
      }
      //permission system
      this.express.use((req,res,next) => {
        let set
        //setup permissions object
        res.locals._p = {allowed: {}, available: []}
        //add a helper function for looking up permissions from views
        res.locals._p.show = () => {return (text,render) => {
          let parts = render(text).split(',')
          if(parts.length !== 2){
            throw new Error('Invalid argument for permission show function')
          }
          if(false === that.permission.allowed(parts[0],set)){
            return ''
          } else {
            return parts[1]
          }
        }}
        //when a permission set is available populate the proper allowed object
        //otherwise populate the entire permission set
        that.permission.all().map((s) => {
          res.locals._p.available.push({
            name: s.name, description: s.description
          })
        })
        if(req.session && req.session._staff && req.session._staff.permission){
          set = req.session._staff.permission
          set.map((s) => {res.locals._p.allowed[s] = s})
        } else {
          that.permission.digest().map((s) => {res.locals._p.allowed[s] = s})
        }
        //load overrides
        let permission = that.config.override.permission
        if(permission){
          permission.available.map((a) => {
            res.locals._p.available.push({
              name: a.name, description: a.description
            })
          })
          for(let a in permission.allowed){
            if(permission.allowed.hasOwnProperty(a)){
              res.locals._p.allowed[a] = a
            }
          }
        }
        //decide whether or not to finish loading the current page
        if(false === that.permission.allowed(req.url,set)){
          res.render(res.locals._view.get('error'),{error: that._l.permdenied})
        } else {
          next()
        }
      })
      next()
    })
    //setup language support
    this.express.use(locale(this.lang.getSupportedSC(),this.lang.defaultSC))
    this.express.use((req,res,next) => {
      if(req.query.lang){
        if(req.session) req.session.lang = req.query.lang
        return res.redirect(301,req.headers.referer || '/')
      }
      if(req.session && req.session.lang) req.locale = req.session.lang
      //actually finally load the pack
      res.locals._l = that._l = that.lang.getPack(
        req.locale,that.config.override.lang)
      //list all packs for cross reference
      let packList = that.lang.all(), packs = []
      Object.keys(packList).forEach((key)=>{ packs.push(packList[key]) })
      res.locals._l._packs = packs
      next()
    })
    //uri translation
    this.express.use((req,res,next) => {
      res.locals._uri = that.router.allForTemplate()
      next()
    })
    //load uri overrides
    if(this.config.override.uri){
      let uri = this.config.override.uri || {}
      for(let u in uri){
        if(uri.hasOwnProperty(u)){
          this.uri.update(u,uri[u])
        }
      }
    }
    //ensure the addCss and addScript parameters are arrays
    if(!(this.config.addCss instanceof Array)){
      this.config.addCss = [this.config.addCss]
    }
    if(!(this.config.addScript instanceof Array)){
      this.config.addScript = [this.config.addScript]
    }
    //ensure the removeCss and removeScript parameters are arrays
    if(!(this.config.removeCss instanceof Array)){
      this.config.removeCss = [this.config.removeCss]
    }
    if(!(this.config.removeScript instanceof Array)){
      this.config.removeScript = [this.config.removeScript]
    }
    //filter through useless entries and add the rest
    this.config.addCss.filter((r)=> { return r && r.uri })
      .map((r)=>{ that.asset.add(r.uri,'text/css') })
    this.config.removeCss.filter((r)=> { return r && r.uri })
      .map((r)=>{ that.asset.remove(r.uri) })
    this.config.addScript.filter((r)=> { return r && r.uri })
      .map((r)=>{
        let defer = false; if(true === r.defer) defer = true
        that.asset.add(r.uri,'text/javascript',defer)
      })
    this.config.removeScript.filter((r)=> { return r && r.uri })
      .map((r)=>{ that.asset.remove(r.uri) })
    //map express natives to our object
    this.static = express.static
    this.use = this.express.use.bind(this.express)
    this.route = this.express.route.bind(this.express)
    this.engine = this.express.engine.bind(this.express)
    this.param = this.express.param.bind(this.express)
    this.set = this.express.set.bind(this.express)
    this.enabled = this.express.enabled.bind(this.express)
    this.disabled = this.express.disabled.bind(this.express)
    this.enable = this.express.enable.bind(this.express)
    this.disable = this.express.disable.bind(this.express)
    this.all = this.express.all.bind(this.express)
    this.listen = this.express.listen.bind(this.express)
    //register method handlers
    getCurrentNodeMethods().forEach((method)=>{
      that[method] = function(){
        let args = Array.prototype.slice.call(arguments,0)
        that.router.p(args[0]) //register route with kado
        that.express[method].apply(that.express,args)
      }
    })
  }
  loadAuthentication(){
    if(!this.config.session.enableLogin) return
    //login
    const that = this
    this.express.post('/login',(req,res) => {
      let json = that.isClientJSON(req)
      let promises = []
      let authTried = 0
      let invalidLoginError = new Error('Invalid login')
      Object.keys(that.modules).forEach((modName) => {
        let mod = that.modules[modName]
        promises.push(new Promise((resolve,reject) => {
          if('function' === typeof mod.authenticate){
            authTried++
            mod.authenticate(
              this,
              req.body.email,
              req.body.password,
              (err,authValid,sessionValues) => {
                if(err) return reject(err)
                if(true !== authValid) return reject(invalidLoginError)
                let session = new ObjectManage(req.session._staff || {})
                session.$load(sessionValues)
                req.session._staff = session.$strip()
                resolve()
              }
            )
          } else { resolve() } //noop
        }))
      })
      Promise.all(promises)
        .then(() => {
          if(0 === authTried){
            that.log.warn('No authentication provider modules enabled')
            throw invalidLoginError
          }
          if(json){ res.json({success: 'Login success'}) }
          else {
            req.flash('success','Login success')
            let referrer = req.session._loginReferrer || '/'
            if(referrer.match(/\.(js|jpg|ico|png|html|css)/i)) referrer = '/'
            res.redirect(302,referrer)
          }
        })
        .catch((err) => {
          if(json){ res.json({error: err.message}) }
          else {
            req.flash('error',err.message || 'Invalid login')
            res.redirect(302,'/login')
          }
        })
    })
    this.express.get('/login',(req,res) => {
      res.render('login')
    })
    this.express.get('/logout',(req,res) => {
      req.session.destroy()
      delete res.locals._staff
      res.redirect(302,'/')
    })
    const isWhitelisted = (uri) => {
      let valid = false
      this.config.session.allowedUri.forEach((allowedUri)=>{
        if(uri === allowedUri) valid = true
      })
      return valid
    }
    //auth protection
    this.express.use((req,res,next) => {
      //private
      if(
        (!req.session || !req.session._staff) &&
        req.url.indexOf('/login') < 0 && false === isWhitelisted(req.url)
      ){
        req.session._loginReferrer = req.url
        res.redirect(302,'/login?c=' + (+new Date()))
      } else if(req.session._staff){
        res.locals._staff = req.session._staff
        if(res.locals && res.locals._staff) delete res.locals._staff.password
        if(this.express.locals && this.express.locals._staff)
          delete this.express.locals._staff.password
        next()
      } else {
        next()
      }
    })
  }
  loadModules(){
    const that = this
    //load modules defined in the config
    Object.keys(this.config.module).forEach((modName)=>{
      let modDef = that.config.module[modName]
      if(modDef.enabled === true && modDef.root) that.addModule(modDef.root)
    })
  }
  loadModels(){
    //do model init if we have it
    let init
    if(this.config.db.modelInit){
      init = path.resolve(this.config.db.modelInit)
    }
    if(init && fs.existsSync(init)){
      debug('Calling model initialization')
      require(init)(this)
    }
  }
  loadLanguagePacks(){
    const that = this
    if(!this.config.languagePacks) this.config.languagePacks = []
    this.config.languagePacks.forEach((packFile)=>{
      if(!fs.existsSync(packFile)) return
      let pack = require(packFile)
      that.lang.addPack(pack._pack_code,pack)
    })
    Object.keys(this.modules).forEach((key)=>{
      let mod = that.modules[key]
      if(!mod || !mod._kado || !(mod._kado.languagePacks instanceof Array))
        return
      mod._kado.languagePacks.forEach((packFile)=>{
        if(!fs.existsSync(packFile)) return
        let pack = require(packFile)
        that.lang.addModule(pack._module_lang,pack._module_name,pack)
      })
    })
    if(this.config.override && this.config.override.languagePacks){
      this.config.override.languagePacks.forEach((packFile) => {
        if(!fs.existsSync(packFile)) return
        let pack = require(packFile)
        that.lang.addPack(pack._pack_code,pack)
      })
    }
  }
  loadModuleInstance(){
    let name = this.config.instanceName
    const that = this
    Object.keys(this.modules).forEach((modKey) => {
      let mod = that.modules[modKey]
      if(name && 'function' === typeof mod[name]) mod[name](that)
    })
  }
  loadViews(){
    if(!this.config.view) this.config.view = {}
    for(let key in this.config.view){
      if(this.config.view.hasOwnProperty(key)){
        this.view.add(key,this.config.view[key])
      }
    }
    if(!this.config.override.view) this.config.override.view = {}
    for(let key in this.config.override.view){
      if(this.config.override.view.hasOwnProperty(key)){
        this.view.add(key,this.config.override.view[key])
      }
    }
  }
  loadSearch(){
    const that = this
    if(!this.config.search.enabled) return
    this.express.use((req,res,next) => {
      res.locals._searchPhrase = req.query.searchPhrase || ''
      next()
    })
    return (req,res) => {
      that.search.byPhrase(that,req.query.searchPhrase || '')
        .then((result) => {
          res.render('search',result)
        })
        .catch((err) => {
          res.render('error',{error: err.message})
        })
    }
  }
  loadRendering(){
    if(!this.config.render.enabled) return
    const that = this
    //update environment
    this.express.locals.basedir = path.resolve(
      path.join(this.INTERFACE_ROOT,'view')
    )
    //set view caching
    if('kado' === process.env.DEV || true === this.config.dev){
      this.express.set('view cache',false)
    } else if (
      this.config.render.viewCache === true ||
      'production' === process.env.NODE_ENV
    ){
      this.express.enable('view cache')
    }
    //setup view engines
    if(this.config.render && this.config.render.enabled === true){
      Object.keys(this.config.render).forEach((renderKey)=>{
        if(
          renderKey === 'enabled' ||
          renderKey === 'viewCache' ||
          that.config.render[renderKey].enabled !== true
        ) return
        let ViewHelper = require(that.config.render[renderKey].root)
        that.view.addHandler(
          renderKey,
          new ViewHelper()
        )
        that.view.activateHandler(renderKey)
      })
    }
    //register our view engine
    this.view.getEngine().register(this)
  }
  loadStaticServer(){
    const that = this
    //override static servers
    let staticRoot = this.config.staticRoot
    if(staticRoot && (staticRoot instanceof Array)){
      staticRoot.forEach((r)=>{
        if(fs.existsSync(r)){
          that.express.use(serveStatic(r,that.express.staticOptions))
        }
      })
    }
    //module static servers
    Object.keys(this.modules).forEach((key)=>{
      let mod = that.modules[key]
      if(!mod || !mod.root || !mod.enabled) return
      let staticPath = path.resolve(path.join(
        path.dirname(mod._kado.root),this.config.instanceName,'public'))
      if(mod._kado.staticRoot) staticPath = path.resolve(mod._kado.staticRoot)
      if(!fs.existsSync(staticPath)) return
      that.express.use(serveStatic(staticPath,that.express.staticOptions))
    })
    //static files
    this.use(serveStatic(
      path.resolve(path.join(this.INTERFACE_ROOT,'public')),
      this.express.staticOptions)
    )
  }
  //ENTRY POINT FUNCTIONS
  routeCli(args){
    const that = this
    if(args.length < 3) return false
    if('test' === args[2]){
      this.test(args[3])
      return true
    }
    Promise.resolve().then(()=>{
      return that.cli.execute(args)
    })
      .then((result)=>{
        if(result) console.log(result)
        process.exit(0)
      })
      .catch((error)=>{
        console.log(error)
        process.exit(1)
      })
  }
  start(){
    const that = this
    return Promise.resolve().then(()=>{
      return that.database.connect()
    })
  }
  stop(){
    this.database.close()
  }
  /**
   * Testing system
   * @param {string} filter passed to --fgrep
   */
  test(filter){
    const spawn = require('child_process').spawn
    const that = this
    this.log.info('Welcome to Test Mode')
    let env = process.env
    env.KADO_TEST = 'kado'
    let mochaRoot = null
    try{
      mochaRoot = path.dirname(require.resolve('mocha'))
      require.resolve('chai')
    } catch(e){
      this.log.error('Mocha and Chai must be installed to run tests try:' +
        ' npm install mocha chai --save-dev')
      process.exit(1)
    }
    let testRunner = path.resolve(path.join(mochaRoot),'bin','mocha')
    let testSpec = path.resolve(path.join(this.KADO_USER_ROOT,'test','kado.js'))
    if(!fs.existsSync(testSpec)){
      this.log.error('There is no test spec to run, please create one at: ' +
        testSpec + ' for more information see https://kado.org')
      process.exit(1)
    }
    let args = [
      testRunner,
      '--throw-deprecation',
      '--reporter','spec',
      '--ui','bdd',
      '-c',
      '--exit'
    ]
    if(filter){
      args.push('--fgrep')
      args.push(filter)
    }
    process.argv.forEach((v,i) => {
      if(i<4) return
      args.push(v)
    })
    let opts = {
      env: env,
      shell: true
    }
    let testProcess = spawn('node',args,opts)
    testProcess.stdout.on('data',(d) => {
      process.stdout.write(d.toString())
    })
    testProcess.stderr.on('data',(d) => {
      process.stderr.write(d.toString())
    })
    testProcess.on('close',(code)=>{
      if(code > 0){
        that.log.warn('Testing has failed')
        process.exit(1)
      } else {
        that.log.info('Testing complete')
      }
      that.log.info('Shutting down test system')
      process.exit(0)
    })
  }
}
