'use strict';


// Keys (stored in local or session storage)
const KEY_CP_STATUS = 'cp_status';
const KEY_METER_VALUE = 'meter_value';
const KEY_CONN_STATUS = 'conn_status';
const KEY_CONN0_STATUS = 'conn_status0';
const KEY_CONN1_STATUS = 'conn_status1';
const KEY_CONN2_STATUS = 'conn_status2';
const KEY_CONN_AVAILABILITY = 'conn_availability';
const KEY_CONN0_AVAILABILITY = 'conn_availability0';
const KEY_CONN1_AVAILABILITY = 'conn_availability1';
const KEY_CONN2_AVAILABILITY = 'conn_availability2';

// Charge Point Status
const CP_ERROR = 'error';
const CP_DISCONNECTED = 'disconnected';
const CP_CONNECTING = 'connecting';
const CP_CONNECTED = 'connected';
const CP_AUTHORIZED = 'authorized';
const CP_INTRANSACTION = 'in_transaction';

// Connector status
const CONN_AVAILABLE = 'Available';
const CONN_CHARGING = 'Charging';
const CONN_UNAVAILABLE = 'Unavailable';
const CONN_FINISHING = 'Finishing';

// OCPP Operations
const START_TRANSACTION = 'StartTransaction';
const STOP_TRANSACTION = 'StopTransaction';
const AUTHORIZE = 'Authorize';
const BOOT_NOTIFICATION = 'BootNotification';

// Availability status
const AVAILABITY_OPERATIVE = 'Operative';
const AVAILABITY_INOPERATIVE = 'Inoperative';

// OCPP Chargepoint ------

// Utility functions
function formatDate(date) {
    let day = String(date.getDate()),
        monthIndex = String(date.getMonth() + 1),
        year = date.getFullYear(),
        h = date.getHours(),
        m = String(date.getMinutes()),
        s = String(date.getSeconds());

    if (day.length < 2) {
        day = '0' + day.slice(-2);
    }
    if (monthIndex.length < 2) {
        monthIndex = '0' + monthIndex.slice(-2);
    }
    if (h.length < 2) {
        h = '0' + h.slice(-2);
    }
    if (m.length < 2) {
        m = '0' + m.slice(-2);
    }
    if (s.length < 2) {
        s = '0' + s.slice(-2);
    }
    return (
        year + '-' + monthIndex + '-' + day + 'T' + h + ':' + m + ':' + s + 'Z'
    );
}

function generateId() {
    const possible =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 36; i++) {
        id += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return id;
}

function isEmpty(str) {
    return !str || 0 === str.length;
}

/**
* Store a key value in session storage
* @param key The key name
* @param value The key value
*/
function setSessionKey(key, value) {
    sessionStorage.setItem(key, value);
}

/**
* Get a key value from session storage
* @param key The key name
* @return The key value
*/
function getSessionKey(key, default_value = '') {
    let v = sessionStorage.getItem(key);
    if (!v) {
        v = default_value;
    }
    return v;
}

/**
* Store a key value in local storage
* @param key The key name
* @param value The key value
*/
function setKey(key, value) {
    localStorage.setItem(key, value);
}

/**
* Get a key value from session storage
* @param key The key name
* @return The key value
*/
function getKey(key, default_value = '') {
    let v = localStorage.getItem(key);
    if (!v) {
        v = default_value;
    }
    return v;
}


class ChargePoint {
    /**
    * Constructor
    * @param a callback function that will receive debug logging information
    */
    constructor() {
        this._websocket = null;
        this._heartbeat = null;
        this._statusChangeCb = null;
        this._availabilityChangeCb = function(connectorId, availability) {};
        this._loggingCb = null;

        // Either "Accepted" or "Rejected"
        this._remoteStartStopResponse = 'Accepted';
        this._remoteStartDelaySeconds = 0;
    }

    /**
    * Set the StatusChange callback, this will be triggered when the internal status
    * of the charge point change
    * @param A callback function which takes two string arguments ("new status","optionnal detail")
    */
    setStatusChangeCallback(cb) {
        this._statusChangeCb = cb;
    }

    /**
    * Set the logging callback, this will be triggered when the charge point want to output/log some information
    * @param A callback function which takes a string argument ("message to log")
    */
    setLoggingCallback(cb) {
        this._loggingCb = cb;
    }

    /**
    * Set the logging callback, this will be triggered when the OCPP server triggers a SetAvailability message
    * @param A callback function which takes two arguments (int + string): (connectorId,"new availability")
    */
    setAvailabilityChangeCallback(cb) {
        this._availabilityChangeCb = cb;
    }

    /**
    * output a log to the logging callback if any
    */
    logMsg(msg) {
        if (this._loggingCb) {
            msg = '[OCPP] ' + msg;
            this._loggingCb(msg);
        }
    }

    /**
    * Set the internal status of the CP and call the status update callbalck if any
    * @param s The new status value
    * @param msg Optional message (for information purpose)
    */
    setStatus(s, msg = '') {
        setSessionKey(KEY_CP_STATUS, s);
        if (this._statusChangeCb) {
            this._statusChangeCb(s, msg);
        }
    }

    /**
    * Handle a command coming from the OCPP server
    */
    async handleCallRequest(id, request, payload) {
        let respOk = JSON.stringify([3, id, { status: 'Accepted' }]);
        let connectorId = 0;
        switch (request) {
            case 'Reset':
                // Reset type can be SOFT, HARD
                let rstType = payload.type;
                this.logMsg('Reset Request: type=' + rstType);
                this.wsSendData(respOk);
                this.wsDisconnect();
                break;

            case 'RemoteStartTransaction':
                const tagId = payload.idTag;
                this.logMsg(
                    'Reception of a RemoteStartTransaction request for tag ' + tagId,
                );

                const rstConf = JSON.stringify([
                    3,
                    id,
                    { status: this._remoteStartStopResponse },
                ]);
                this.wsSendData(rstConf);

                if (this._remoteStartStopResponse == 'Rejected') {
                    break;
                }

                // Simulate time it takes for user to plug in charger
                this.logMsg(
                    `Simulating ${this._remoteStartDelaySeconds} sec delay for user to plug in charger`,
                );
                await new Promise((resolve) =>
                    setTimeout(resolve, 1000 * this._remoteStartDelaySeconds),
                );

                this.startTransaction(tagId);
                break;

            case 'RemoteStopTransaction':
                let stop_id = payload.transactionId;
                this.logMsg(
                    'Reception of a RemoteStopTransaction request for transaction ' +
                    stop_id,
                );
                const respConf = JSON.stringify([
                    3,
                    id,
                    { status: this._remoteStartStopResponse },
                ]);
                this.wsSendData(respConf);
                if (this._remoteStartStopResponse == 'Rejected') {
                    break;
                }
                this.stopTransactionWithId(stop_id);
                break;

            case 'TriggerMessage':
                let requestedMessage = payload.requestedMessage;
                // connectorId is optional thus must check if it is provided
                if (payload['connectorId']) {
                    connectorId = payload['connectorId'];
                }
                this.logMsg(
                    'Reception of a TriggerMessage request (' + requestedMessage + ')',
                );
                this.wsSendData(respOk);
                this.triggerMessage(requestedMessage, connectorId);
                break;

            case 'ChangeAvailability':
                const avail = payload.type;
                connectorId = payload.connectorId;
                this.logMsg(
                    'Reception of a ChangeAvailability request (connector ' +
                    connectorId +
                    ' ' +
                    avail +
                    ')',
                );
                this.wsSendData(respOk);
                this.setConnectorAvailability(Number(connectorId), avail);
                break;

            case 'UnlockConnector':
                this.wsSendData(respOk);
                break;

            case 'GetConfiguration':
                let requestedMessage = payload.requestedMessage;
                this.logMsg(
                    'Reception of a GetConfiguration request (' + requestedMessage + ')',
                );
                const configuration = [
                    3,
                    id,
                    {
                        unknownKey: [],
                        configurationKey: [
                            {
                                key: 'HeartbeatInterval',
                                readonly: false,
                                value: '900',
                            },
                        ],
                    },
                ];
                this.wsSendData(JSON.stringify(configuration));
                break;

            default:
                let error = JSON.stringify([4, id, 'NotImplemented']);
                this.wsSendData(error);
                break;
        }
    }

    /**
    * Handle the response from the OCPP server to a command
    * @param payload The payload part of the OCPP message
    */
    handleCallResult(payload) {
        let la = this.getLastAction();
        switch (la) {
            case BOOT_NOTIFICATION:
                if (payload.status == 'Accepted') {
                    this.logMsg('Connection accepted');
                    let hb_interval = payload.interval;
                    this.setHeartbeat(hb_interval);
                    this.setStatus(CP_CONNECTED);
                } else {
                    this.logMsg('Connection refused by server');
                    this.wsDisconnect();
                }
                break;
            case AUTHORIZE:
                if (payload.idTagInfo.status == 'Invalid') {
                    this.logMsg('Authorization failed');
                } else {
                    this.logMsg('Authorization OK');
                    this.setStatus(CP_AUTHORIZED);
                }
                break;
            case START_TRANSACTION:
                let transactionId = payload.transactionId;
                if (!transactionId) {
                    // doing this so StatusNotifications like "CHARGING" doesnt override transaction id
                    break;
                }
                setSessionKey('TransactionId', transactionId);
                this.setStatus(CP_INTRANSACTION, 'TransactionId: ' + transactionId);
                this.logMsg('Transaction id is ' + transactionId);
                break;
            case STOP_TRANSACTION:
                // assuming id 1 for now.
                const connectorId = 1;
                this.setConnectorStatus(connectorId, CONN_AVAILABLE);
                break;

            default:
                if (Object.keys(payload).length > 0) {
                    this.logMsg(
                        'NOT IMPLEMENTED in handleCallResult in ocpp_chargepont.js, payload: ' +
                        JSON.stringify(payload),
                    );
                }
        }
    }

    /**
    * Handle an error response from the OCPP server
    * @param errCode The error code
    * @param errMsg  The clear text description of the error
    *
    handleCallError(errCode, errMsg) {
      this.setStatus(CP_ERROR, 'ErrorCode: ' + errCode + ' (' + errMsg + ')');
    }
  
    /**
    * Send an Authorize call to the OCPP Server
    * @param tagId the id of the RFID tag to authorize
    */
    authorize(tagId) {
        this.setLastAction('Authorize');
        this.logMsg('Requesting authorization for tag ' + tagId);
        let id = generateId();
        let Auth = JSON.stringify([
            2,
            id,
            'Authorize',
            {
                idTag: tagId,
            },
        ]);
        this.wsSendData(Auth);
    }

    /**
    * Send a StartTransaction call to the OCPP Server
    * @param tagId the id of the RFID tag currently authorized on the CP
    */
    startTransaction(tagId, connectorId = 1, reservationId = 0) {
        this.setStatus(CP_INTRANSACTION);
        let id = generateId();

        // Always start on metervalue 0.
        $('#metervalue').val(0);
        _cp.setMeterValue(0);

        let strtT = JSON.stringify([
            2,
            id,
            START_TRANSACTION,
            {
                connectorId: connectorId,
                idTag: tagId,
                meterStart: 0,
                timestamp: luxon.DateTime.utc().toISO(),
                reservationId: reservationId,
            },
        ]);
        this.logMsg(
            'Starting Transaction for tag ' +
            tagId +
            ' (connector:' +
            connectorId +
            ', meter value=' +
            0 +
            ')',
        );
        this.wsSendData(strtT);
        this.setConnectorStatus(connectorId, CONN_CHARGING, true);
        this.setLastAction(START_TRANSACTION);
    }

    /**
    * Send a StopTransaction call to the OCPP Server
    * @param tagId the id of the RFID tag currently authorized on the CP
    */
    stopTransaction(tagId) {
        let transactionId = parseInt(getSessionKey('TransactionId'));
        this.stopTransactionWithId(transactionId, tagId);
    }

    /**
    * Send a StopTransaction call to the OCPP Server
    * @param transactionId the id of the transaction to stop
    * @param tagId the id of the RFID tag currently authorized on the CP
    */
    stopTransactionWithId(transactionId, tagId = 'DEADBEEF') {
        this.setLastAction(STOP_TRANSACTION);
        this.setStatus(CP_AUTHORIZED);
        let meterValue = this.meterValue();
        this.logMsg(
            'Stopping Transaction with id ' +
            transactionId +
            ' (meterValue (Wh) =' +
            meterValue +
            ')',
        );
        let id = generateId();
        let stopParams = {
            transactionId: transactionId,
            timestamp: luxon.DateTime.utc().toISO(),
            meterStop: meterValue,
            reason: 'Local',
            transactionData: [
                {
                    sampledValue: [
                        {
                            value: '0', // Hardcoded that transactions start at 0 Wh.
                            context: 'Transaction.Begin',
                            format: 'Raw',
                            measurand: 'Energy.Active.Import.Register',
                            location: 'Outlet',
                            unit: 'Wh',
                        },
                    ],
                    timestamp: luxon.DateTime.utc().toISO(),
                },
                {
                    sampledValue: [
                        {
                            value: String(meterValue),
                            context: 'Transaction.End',
                            format: 'Raw',
                            measurand: 'Energy.Active.Import.Register',
                            location: 'Outlet',
                            unit: 'Wh',
                        },
                    ],
                    timestamp: luxon.DateTime.utc().toISO(),
                },
            ],
        };
        if (!isEmpty(tagId)) {
            stopParams['idTag'] = tagId;
        }
        let stpT = JSON.stringify([2, id, 'StopTransaction', stopParams]);
        this.wsSendData(stpT);
        this.setConnectorStatus(1, CONN_FINISHING);
    }

    /**
    * Implement the TriggerMessage request
    * @param requestedMessage the message that shall be triggered
    * @param c connectorId concerned by the message (if any)
    */
    triggerMessage(requestedMessage, c = 0) {
        switch (requestedMessage) {
            case 'BootNotification':
                this.sendBootNotification();
                break;
            case 'Heartbeat':
                this.sendHeartbeat();
                break;
            case 'MeterValues':
                this.sendMeterValue(c);
                break;
            case 'StatusNotification':
                this.sendStatusNotification(c);
                break;
            case 'DiagnosticStatusNotification':
                break;
            case 'FirmwareStatusNotification':
                break;
            default:
                this.logMsg('Requested Message not supported: ' + requestedMessage);
                break;
        }
    }

    /**
    * Send a BootNotification call to the OCPP Server
    */
    sendBootNotification() {
        this.logMsg('Sending BootNotification');
        this.setLastAction(BOOT_NOTIFICATION);
        let id = generateId();
        let bn_req = JSON.stringify([
            2,
            id,
            'BootNotification',
            {
                chargePointVendor: 'Elmo',
                chargePointModel: 'Elmo-Virtual1',
                chargePointSerialNumber: 'elm.001.13.1',
                chargeBoxSerialNumber: 'elm.001.13.1.01',
                firmwareVersion: '0.9.87',
                iccid: '',
                imsi: '',
                meterType: 'ELM NQC-ACDC',
                meterSerialNumber: 'elm.001.13.1.01',
            },
        ]);
        this.wsSendData(bn_req);
    }

    // @todo: Shitty code to remove asap => real transaction support
    setLastAction(action) {
        setSessionKey('LastAction', action);
    }
    // @todo: Shitty code to remove asap
    getLastAction() {
        return getSessionKey('LastAction');
    }

    /**
    * Setup heartbeat sending at the appropriate period
    * (clearing any previous setup)
    * @param period The heartbeat period in seconds
    */
    setHeartbeat(period) {
        this.logMsg('Setting heartbeat period to ' + period + 's');
        if (this._heartbeat) {
            clearInterval(this._heartbeat);
        }
        this._heartbeat = setInterval(this.sendHeartbeat, period * 1000);
    }

    /**
    * Send a heartbeat to the OCPP Server
    */
    sendHeartbeat() {
        this.setLastAction('Heartbeat');
        let id = generateId();
        let HB = JSON.stringify([2, id, 'Heartbeat', {}]);
        this.logMsg('Heartbeat');
        this.wsSendData(HB);
    }

    /**
    * Send data to the server (will be also logged in console)
    * @data the data to send
    */
    wsSendData(data) {
        console.log('SEND: ' + data);
        if (this._websocket) {
            this._websocket.send(data);
        } else {
            this.setStatus(CP_ERROR, 'No connection to OCPP server');
        }
    }

    /**
    * @return the internal state of the CP
    */
    status() {
        return getSessionKey(KEY_CP_STATUS);
    }

    /**
    * Open the websocket and set internal state accordingly
    * @param wsurl The URL of the OCPP server
    * @param cpid  The charge point identifief (as defined in OCPP server)
    */
    wsConnect(wsurl, cpid) {
        if (this._websocket) {
            this.setStatus(
                CP_ERROR,
                'Socket already opened. Closing it. Retry later',
            );
            this._websocket.close(3001);
        } else {
            this._websocket = new WebSocket(wsurl + '' + cpid, [
                'ocpp1.6',
                'ocpp1.5',
            ]);
            let self = this;

            /**
                * OnOpen Callback
                */
            this._websocket.onopen = function (evt) {
                self.setStatus(CP_CONNECTING);
                self.sendBootNotification();
            };

            /**
                * OnError Callback
                */
            this._websocket.onerror = function (evt) {
                switch (self._websocket.readyState) {
                    case 1: // OPEN
                        self.setStatus(CP_ERROR, 'ws normal error: ' + evt.type);
                        break;
                    case 3: // CLOSED
                        self.setStatus(
                            CP_ERROR,
                            'connection cannot be opened: ' + evt.type,
                        );
                        break;
                    default:
                        self.setStatus(CP_ERROR, 'websocket error: ' + evt.type);
                        break;
                }
            };

            /**
                * OnMessage Callback
                * Decode the type of message and pass it to the appropriate handler
                */
            this._websocket.onmessage = function (msg) {
                console.log('RECEIVE: ' + msg.data);
                let ddata = JSON.parse(msg.data);

                // Decrypt Message Type
                let msgType = ddata[0];
                switch (msgType) {
                    case 2: // CALL
                        let id = ddata[1];
                        let request = ddata[2];
                        let payload = null;
                        if (ddata.length > 3) {
                            payload = ddata[3];
                        }
                        self.handleCallRequest(id, request, payload);
                        break;
                    case 3: // CALLRESULT
                        self.handleCallResult(ddata[2]);
                        break;
                    case 4: // CALLERROR
                        self.handleCallError(ddata[2], ddata[3]);
                        break;
                }
            };

            /**
            * OnClose Callback
            */
            this._websocket.onclose = function (evt) {
                if (evt.code == 3001) {
                    self.setStatus(CP_DISCONNECTED);
                    self.logMsg('Connection closed');
                    self._websocket = null;
                } else {
                    self.setStatus(CP_ERROR, 'Connection error: ' + evt.code);
                    self.logMsg('Connection error: ' + evt.code);
                    self._websocket = null;
                }
            };
        }
    }

    /**
    * Close the websocket and set internal state accordingly
    */
    wsDisconnect() {
        if (this._websocket) {
            this._websocket.close(3001);
        }
        this.setStatus(CP_DISCONNECTED);
    }

    /**
    * Return the meter value
    */
    meterValue() {
        return parseInt(getSessionKey(KEY_METER_VALUE, '0'));
    }

    /**
    * Set the meter value (and optionnally update the OCPP server with it)
    * @param v the new meter value
    * @param updateServer if set to true, update the server with the new meter value
    */
    setMeterValue(v, updateServer = false) {
        setSessionKey(KEY_METER_VALUE, v);
        if (updateServer) {
            this.sendMeterValue();
        }
    }

    /**
    * update the server with the internal meter value
    */
    sendMeterValue(connectorId = 0) {
        let mvreq = {};
        this.setLastAction('MeterValues');
        let meter = getSessionKey(KEY_METER_VALUE);
        let id = generateId();
        let transactionId = parseInt(getSessionKey('TransactionId'));
        mvreq = JSON.stringify([
            2,
            id,
            'MeterValues',
            {
                connectorId: connectorId,
                transactionId: transactionId,
                meterValue: [
                    {
                        sampledValue: [
                            {
                                value: meter,
                                context: 'Sample.Periodic',
                                format: 'Raw',
                                measurand: 'Energy.Active.Import.Register',
                                location: 'Outlet',
                                unit: 'Wh',
                            },
                        ],
                        timestamp: luxon.DateTime.utc().toISO(),
                    },
                ],
            },
        ]);
        this.logMsg(
            'Send Meter Values (Wh): ' + meter + ' (connector ' + connectorId + ')',
        );
        this.wsSendData(mvreq);
    }

    /**
    * Get the status of given connector
    * @param c connectorId
    * @return connector status as string
    */
    connectorStatus(c) {
        let key = KEY_CONN_STATUS + c;
        return getSessionKey(key);
    }

    /**
    * Update status of given connector
    * @param {number} connectorId
    * @param {string} newStatus for connector
    * @param {boolean} updateServer if true, also send a StatusNotification to server
    */
    setConnectorStatus(connectorId, newStatus, updateServer = false) {
        let key = KEY_CONN_STATUS + connectorId;
        setSessionKey(key, newStatus);
        if (updateServer) {
            this.sendStatusNotification(connectorId, newStatus);
        }
    }

    /**
     * Send a StatusNotification to the server with the new status of the specified connector
     * @param {number} connectorId The connector id (0 for CP, 1 for connector 1, etc...)
     */
    sendStatusNotification(connectorId) {
        let st = this.connectorStatus(connectorId);
        this.setLastAction('StatusNotification');
        let id = generateId();
        let sn_req = JSON.stringify([
            2,
            id,
            'StatusNotification',
            {
                connectorId: connectorId,
                status: st,
                errorCode: 'NoError',
                info: '',
                timestamp: luxon.DateTime.utc().toISO(),
                vendorId: '',
                vendorErrorCode: '',
            },
        ]);
        this.logMsg('Sending StatusNotification for connector ' + connectorId + ': ' + st);
        this.wsSendData(sn_req);
    }

    /**
    * Get availability for given connector
    * (availability is persistent thus stored in local storage instead of session storage)
    * @param {number} connectorId 
    * @returns {"Operative" | "Inoperative"} availability for connector
    */
    availability(connectorId = 0) {
        let key = KEY_CONN_AVAILABILITY + connectorId;
        return getKey(key, AVAILABITY_OPERATIVE);
    }

    /**
    * Update the availability of given connector
    * (availability is set by remote server thus no "updateServer" flag as for connector status)
    * @param {number} connectorId 
    * @param {"Operative" | "Inoperative"} newAvailability for connector
    */
    setConnectorAvailability(connectorId, newAvailability) {
        let key = KEY_CONN_AVAILABILITY + connectorId;
        setKey(key, newAvailability);
        if (newAvailability == AVAILABITY_INOPERATIVE) {
            this.setConnectorStatus(connectorId, CONN_UNAVAILABLE, true);
        } else if (newAvailability == AVAILABITY_INOPERATIVE) {
            this.setConnectorStatus(connectorId, CONN_AVAILABLE, true);
        }
        if (this._availabilityChangeCb) {
            this._availabilityChangeCb(connectorId, newAvailability);
        }
        if (connectorId === 0) {
            this.setConnectorAvailability(1, newAvailability);
            this.setConnectorAvailability(2, newAvailability);
        }
    }
}

// Jquery stuff -----------------------

// Keys (stored in local storage)
const WSURL = 'WSURL';
const CPID = 'CPID';
const TAGID = 'TAG';

// the charge point
let _cp = new ChargePoint();

// Log message to the JS Console and into the Log TextArea
function logMsg(msg) {
    console.log(msg);
    let html_console = $('#console');
    html_console.append('&#10;' + msg);
    html_console.scrollTop(html_console.get(0).scrollHeight);
}

function isEmpty(str) {
    return !str || 0 === str.length;
}

function setKey(key, value) {
    localStorage.setItem(key, value);
}

function keyDefaultValue(key) {
    let v = '';
    switch (key) {
        case WSURL:
            v = 'ws:*localhost:8080/steve/websocket/CentralSystemService/';
            break;
        case CPID:
            v = 'CP01';
            break;
        case TAGID:
            v = 'DEADBEEF';
            break;
    }
    return v;
}

function getKey(key) {
    let v = localStorage.getItem(key);
    if (isEmpty(v)) {
        v = keyDefaultValue(key);
    }
    return v;
}

function statusChangeCb(s, msg) {
    $('.indicator').hide();
    // Set only proper one
    switch (s) {
        case CP_DISCONNECTED:
            $('#badge_disconnected').show();
            $('#connect').show();
            $('#disconnect').hide();
            $('#send').hide();
            $('#start').hide();
            $('#stop').hide();
            $('#heartbeat').hide();
            $('#mv').hide();
            $('#status0').hide();
            $('#status1').hide();
            $('#data_transfer').hide();
            break;

        case CP_CONNECTING:
            $('#badge_connecting').show();
            $('#connect').hide();
            $('#disconnect').show();
            break;

        case CP_CONNECTED:
            $('#badge_connected').show();
            $('#connect').hide();
            $('#disconnect').show();
            $('#send').show();
            $('#start').show();
            $('#stop').show();
            $('#heartbeat').show();
            $('#mv').show();
            $('#status0').show();
            $('#status1').show();
            // RFU $('#data_transfer').show();
            break;

        case CP_AUTHORIZED:
            $('#badge_available').show();
            break;

        case CP_INTRANSACTION:
            $('#badge_transaction').show();
            break;

        case CP_ERROR:
            $('#badge_error').show();
            if (!isEmpty(msg)) {
                logMsg(msg);
            }
            break;
        default:
            $('#badge_error').show();
            if (!isEmpty(msg)) {
                logMsg(msg);
            } else {
                logMsg('ERROR: Unknown status');
            }
    }
}

/**
 * 
 * @param {number} c ConnectorId
 * @param {"Operative" | "Inoperative"} s 
 */
function availabilityChangeCb(c, s) {
    let dom_id = '#AVAILABILITY_CON' + c;
    $(dom_id).val(s);
    let dom_id = '#STATUS_CON' + c;
    $(dom_id).val(_cp.connectorStatus(c));
}

//
// Entry point of the simulator
// (attach callbacks to each button and wait for user action)
//

$(document).ready(function () {
    _cp.setLoggingCallback(logMsg);
    _cp.setStatusChangeCallback(statusChangeCb);
    _cp.setAvailabilityChangeCallback(availabilityChangeCb);
    _cp.setStatus(CP_DISCONNECTED);

    // Init the setting form
    $('#WSURL').val(getKey(WSURL));
    $('#CPID').val(getKey(CPID));
    $('#TAG').val(getKey(TAGID));
    $('#metervalue').val(0);
    // availabilityChangeCb(0, _cp.availability(0));
    // availabilityChangeCb(1, _cp.availability(1));

    // Define settings call back
    $('#cpparams').submit(function (e) {
        const formData = new FormData(e.target);
        console.log('Hellow');
        for (let pair of formData.entries()) {
            setKey(pair[0], pair[1]);
        }
    });

    $('#connect').click(function () {
        $('.indicator').hide();
        _cp.wsConnect(getKey(WSURL), getKey(CPID));
    });

    $('#disconnect').click(function () {
        _cp.wsDisconnect();
    });

    $('#send').click(function () {
        _cp.authorize($('#TAG').val());
    });

    $('#start').click(function () {
        const meter = parseInt($('#metervalue').val());
        _cp.setMeterValue(meter * 1000, false);
        _cp.startTransaction($('#TAG').val());
    });

    $('#stop').click(function () {
        const meter = parseInt($('#metervalue').val());
        _cp.setMeterValue(meter * 1000, false);
        _cp.stopTransaction($('#TAG').val());
    });

    $('#mv').click(function () {
        _cp.sendMeterValue();
    });

    $('#mvplus').click(function () {
        // Set chargepoint metervalues
        const meter = parseInt($('#metervalue').val()) + 1;
        _cp.setMeterValue(meter * 1000, false);

        // Increment metervalue input box
        $('#metervalue').val(meter);
    });

    $('#heartbeat').click(function () {
        _cp.sendHeartbeat();
    });

    $('#CP0_STATUS').change(function () {
        _cp.setConnectorStatus(0, $('#STATUS_CON0').val(), false);
    });
    $('#CP1_STATUS').change(function () {
        const value = document.getElementById('STATUS_CON1').value;
        _cp.setConnectorStatus(1, value, false);
    });
    $('#status0').click(function () {
        _cp.setConnectorStatus(0, $('#STATUS_CON0').val(), true);
    });
    $('#status1').click(function () {
        const value = document.getElementById('STATUS_CON1').value;
        _cp.setConnectorStatus(1, value, true);
    });
    $('#REMOTE_START_DELAY').change(function () {
        const value = document.getElementById('REMOTE_START_DELAY').value;
        _cp._remoteStartDelaySeconds = value;
    });

    $('#data_transfer').click(function () {
        /*
            setLastAction("DataTransfer");
            let id=generateId();
            let DT = JSON.stringify([2,id, "DataTransfer", {
                "vendorId": "rus.avt.cp",
                "messageId": "GetChargeInstruction",
                "data": ""
            }]);
            wsSendData(DT);
            */
    });

    $('#connect').on('change', function () {
        /* if (_websocket) {
                _websocket.close(3001);
            }*/
    });

    $('#REMOTE_START_STOP_RESPONSE').on('change', () => {
        const value = document.getElementById('REMOTE_START_STOP_RESPONSE').value;
        _cp._remoteStartStopResponse = value;
    });

    logMsg('OCPP Simulator ready');
});
