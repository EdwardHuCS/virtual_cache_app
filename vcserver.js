#!/usr/bin/env nodejs
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express();
const youtubedl = require('youtube-dl');
const exportToCSV = require('./exportCSV.js')
const MongoClient = require('mongodb').MongoClient;
const mongoose = require('mongoose');
const Promise = require('bluebird');
mongoose.Promise = Promise;// Use bluebird
const version = require('mongoose-version');
const Schemas = require('./schemas.js');
const isDeveloping = process.env.NODE_ENV !== 'production';
//const MONGO_URL = 'mongodb://localhost:27017/virtualcache';
const MONGO_URL = require('./env.js').MONGO_URL;
const VIDEO = './sunset.mp4';
const FILESIZE = fs.statSync(VIDEO).size;

//SETUP CODE
app.use('/', express.static(path.join(__dirname, '')));
//app.set('view engine', 'pug');
app.use(bodyParser.urlencoded({
	extended: true
}));
app.use(bodyParser.json());
if(isDeveloping){
	console.log('Development mode');
	app.use(function (req, res, next) {
		// Website you wish to allow to connect
		res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8080');
		// Request methods you wish to allow
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
		// Request headers you wish to allow
		res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
		// Set to true if you need the website to include cookies in the requests sent
		// to the API (e.g. in case you use sessions)
		res.setHeader('Access-Control-Allow-Credentials', true);
		// Pass to next layer of middleware
		next();
	});
}
//DB setup
const db = mongoose.connection;
// const locationSchema = mongoose.Schema({
// 	type:'Point',
// 	coordinates:[Number]
// });
// const deviceSchema = mongoose.Schema({
// 	name: String,
// 	cache:[{name:String, size:Number}],
// 	d2d:0,
// 	time:Number,
// 	loc: {
// 		type: [Number],	// [<longitude>, <latitude>]
// 		index: '2d'			// create the geospatial index
// 	}
// });
const locationSchema = Schemas.locationSchema;
const deviceSchema = Schemas.deviceSchema;
deviceSchema.plugin(version);
deviceSchema.set('collection', 'devices')
const Device = mongoose.model('Device', deviceSchema);
//DB start
mongoose.connect(MONGO_URL);
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
	// we're connected!
	console.log('MongoDB connected');
});

var virtual_cache;
MongoClient.connect(MONGO_URL, (err, database) => {
	if(err) throw err;
	virtual_cache = database;
	//Server Startup

	app.listen(process.env.PORT || 3000,'0.0.0.0',() => {
		console.log(`Example app listening on port ${process.env.PORT || 3000}!`);
	});
});
//ROUTES

app.get('/db', function (req, res) {
	console.log('/db requested');
	const currentDB_P = Device.find().exec()

	const history_P = virtual_cache
	.collection('versions')
	.find()
	.toArray()

	Promise.all([currentDB_P, history_P])
	.then(arr => res.status(201).send(arr));
});

//Json version of logs
app.post('/logs', (req, res) => {
	const query = {'name':req.body.name};
	Device.findOne(query,(err,result) => {
		console.log(req.body);
		if(result == null) {
			const device = new Device(req.body);
			device.save()
			.then(doc => res.status(201).end())
			.catch(err => console.error(err));
		} else {
			Object.assign(result, req.body);
			result.save()
			.then(doc => res.status(201).end())
			.catch(err => console.error(err));
		}
	});
});

//GeoNear features
app.post('/locsearch', (req,res) => {
	// [long, lat]
	console.log('locsearch', req.body);
	const center =	req.body.center || [0,0];
	const radiusRad = req.body.radius/6731 || 8/6731;
	console.log(center, radiusRad);
	// find a location
	Device.find({
		loc: {
			$near: center,
			$maxDistance: radiusRad
		}
	}).limit(10).exec(function(err, locations) {
		if (err) {
			return res.status(500).send(err);
		}
		res.status(201).send(locations);
	});
});

//erase DB contents
app.get('/erase', (req,res) => {
	db.collection('versions').drop();
	db.collection('devices').drop();
	res.status(200).redirect('/');
});

//download video file
let connections = new Map();
app.get('/test', (req, res) => {
	let currentDevice = req.headers['user-agent'];
	let time = Date.now();
	res.download(`./${VIDEO}`, VIDEO, err => {
		time = Date.now() - time;
		time/=1000;
		let ratio = (FILESIZE/1000000) / time;
		let now = new Date();
		connections.set(currentDevice, {date:`${now.getMonth()}:${now.getDate()}:${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`, filesize:FILESIZE,time:time,ratio:ratio});
	});
});

//get data
app.get('/cxn', (req, res) => {
	let string = '';
	connections.forEach((v,k)=>{
		let json = {key:k, value:v};
		string+=`${JSON.stringify(json,null, '\t')}`;
	});
	res.send(string);
});

//stream
app.get('/stream', (req, res) => {
	//stream youtube video
	const video = youtubedl('https://www.youtube.com/watch?v=YQHsXMglC9A',
	// Optional arguments passed to youtube-dl.
	['--format=18'],
	// Additional options can be given for calling `child_process.execFile()`.
	{ cwd: __dirname });
	// Will be called when the download starts.
	video.on('info', function(info) {
		console.log('Download started');
		console.log('filename: ' + info._filename);
		console.log('size: ' + info.size);
	});
	res.writeHead(200, {
		"Content-Length": "unknown",
		"Content-Type": "video/mp4"
	});
	video.pipe(fs.createWriteStream('myvideo.mp4'));
	video.pipe(res);
});

//csv
app.get('/csv', (req, res) => {
	const currentDB_P = Device.find().exec()
	currentDB_P
	.then( arr => exportToCSV(arr, 'file.csv'))
	.then( stream => {
		res.writeHead(200, {
			 "Content-Disposition": "attachment;filename=" + 'file.csv',
			'Content-Type':'text/csv'
		});
		stream.pipe(res);
	});
});
