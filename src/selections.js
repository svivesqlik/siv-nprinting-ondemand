"use strict";

/**
 *  This file is used to fetch all current selections.
 */
var SharingViaUrl = (function () {
    var _app,
        lastrows = {},
        states = {},
        selected = {},
        _field_types = {},
        MAX_DIM_WIDTH = 1,
        MAX_HEIGHT = 10000,
        _SHARING_LIMIT = 12 * 1000,
        _LOG_STATES = false;

    var SharingViaUrl = {

        /**
         * Obtains all values for the field and what is their state (selected/alternative etc.)
         * Calls itself recursively when there are a lot of rows (more than 10k).
         */
        getAllDataWithHypercube: function (_self, field, datapage, with_state, promiseresolve) {
            var type = _self._field_types[field];

            if (!datapage) {
                datapage = [{
                    qTop: 0,
                    qLeft: 0,
                    qWidth: MAX_DIM_WIDTH,
                    qHeight: MAX_HEIGHT
                }];
            }

            if (!lastrows[field]) {
                lastrows[field] = 0;
            }

            _app.createList({
                "qState": "$",
                "qStateName": "$",
                //
                // This below are actually KEY parameters, it adds a comprehensive information
                // on the kind of selection for each single value on the field. That is, 
                // gives alternatives, excluded and selected-excluded for each value.
                // @See / @Refer_to: 
                //  https://help.qlik.com/en-US/sense-developer/1.1/Subsystems/Workbench/Content/BuildingExtensions/API/ExtensionsApi/initialproperties-property.htm
                //
                "qShowAlternatives": true,
                "qShowExcluded": true,

                "qDef": {
                    "qShowExcluded": true,
                    "qFieldDefs": [field],
                    "qSortCriterias": [{
                        "qSortByState": 1
                    }]
                },
                "qInitialDataFetch": datapage
            }, function (reply) {

                if (!reply.qListObject) {
                    console.log('Hypercube not valid or could not be retrieved...');
                    return;
                } else {
                    //console.log('Hypercube reply');
                }
                var numrec = reply.qListObject.qSize.qcy;
                var page = reply.qListObject.qDataPages[0].qMatrix;

                for (var j = 0; j < page.length; ++j) {
                    lastrows[field]++;

                    if (!selected[field]) {
                        selected[field] = [];
                    }

                    if (_LOG_STATES) {
                        if (!states[field]) {
                            states[field] = {};
                        }
                        if (!states[field][page[j][0].qState]) {
                            states[field][page[j][0].qState] = {
                                counter: 0,
                                items: []
                            }
                        }
                        states[field][page[j][0].qState].counter++;
                        states[field][page[j][0].qState].items.push(page[j][0].qText);
                    }

                    if (with_state.indexOf(page[j][0].qState) > -1) {

                        // Only pick the fields with some specific state
                        if (type == 'number') {
                            selected[field].push(page[j][0].qNum);
                        } else if (type == 'string') {
                            selected[field].push(page[j][0].qText);
                        }

                    }
                }

                // Remove the hypercube to avoid it being recalled when a selection is made
                _app.destroySessionObject(reply.qInfo.qId);

                if (numrec <= (lastrows[field] + 1)) {
                    promiseresolve(true);
                    return;
                }

                // We have more data to request
                var requestPage = [{
                    qTop: lastrows[field] + 1,
                    qLeft: 0,
                    qWidth: MAX_DIM_WIDTH,
                    qHeight: MAX_HEIGHT
                }];
                _self.getAllDataWithHypercube(_self, field, requestPage, with_state, promiseresolve);

            });
        },

        _getSelections: function (sel) {
            var _self = this;
            return new Promise(function (resolve, reject) {

                if (!sel) {
                    resolve(true);
                    return;
                }

                //
                // For the states information refer to this:
                // @Refer_to: https://help.qlik.com/en-US/sense-developer/June2018/Subsystems/EngineAPI/Content/DiscoveringAndAnalysing/MakeSelections/clear-all-selections.htm 
                //
                // O -> Optional state (could be potentially selected)
                // X -> Excluded (can't be selected)
                // S -> It's currently selected
                // XS -> Excluded yet selected+
                // A -> Alternative

                // All values are selected
                var all_selection = (sel.qSelected == 'ALL');

                if (all_selection || sel.qTotal > sel.qSelectionThreshold) {

                    // If the are only a few selected values (but more than the informed limit
                    // by Sense (selectionThreshold), pick them.
                    _self.getAllDataWithHypercube(_self, sel.qField, null, ['S', 'XS'], resolve);

                } else {
                    // There are a few selected values, and are lower than the SelectionThreshold limit. 
                    // Just pick them straight away.
                    var list = [];
                    var type = _self._field_types[sel.qField];

                    for (var i = 0; i < sel.qSelectedFieldSelectionInfo.length; ++i) {
                        var val = sel.qSelectedFieldSelectionInfo[i].qName;
                        if (type == 'number') {
                            list.push(Number(val));
                        } else {
                            list.push(val);
                        }
                    }

                    selected[sel.qField] = list;
                    resolve(true);
                }
            });
        },


        /**
         * Queries the app API to caracterise the fields on the application. Caracterise means tag the 
         * fields as number or string.
         */
        _getFieldsAndDimensionInformation: function () {
            return new Promise(function (resolve, reject) {

                _app.model.waitForOpen.promise.then(function () {
                    // Retrieve all fields and evaluate their tags to see what kind
                    // of type we are dealing with, wether is a numeric or a string
                    // value (selections will need to be done differently).
                    _app.model.enigmaModel.getTablesAndKeys({
                            "qcx": 1000,
                            "qcy": 1000
                        }, {
                            "qcx": 0,
                            "qcy": 0
                        },
                        30,
                        true,
                        false
                    ).then(function (res) {

                        var tables_and_fields = res.qtr;
                        var fieldsTypeCache = {};

                        for (var t = 0; t < tables_and_fields.length; ++t) {
                            var c_table = tables_and_fields[t];
                            for (var f = 0; f < c_table.qFields.length; ++f) {
                                var cf = c_table.qFields[f]
                                // Find if it's an integer or a string.
                                fieldsTypeCache[cf.qName] = cf.qTags.indexOf('$numeric') > -1 ? 'number' : 'string';
                            }
                        }

                        resolve(fieldsTypeCache);

                    });
                });
            });

        },

        /**
         * Wrapper to perform on a sequential manner the retrieval of selections
         */
        selectionsPromiseWrap: function (_self, selections, index, callback) {

            if (index >= selections.length) {
                callback();
                return;
            }

            _self._getSelections(selections[index]).then(function () {
                _self.selectionsPromiseWrap(_self, selections, ++index, callback);
            });

        },

        getSelectionValues: function (app, sels) {
            _app = app;
            states = {};
            var _self = this;

            selected = {};
            lastrows = {};

            return new Promise(function (resolve, reject) {

                _self._getFieldsAndDimensionInformation().then(function (field_types) {

                    _self._field_types = field_types;

                    _self.selectionsPromiseWrap(_self, sels, 0, function () {

                        if (_LOG_STATES) {
                            console.log(states);
                        }

                        var result_list = [];

                        for (var c in selected) {
                            result_list.push({
                                fieldName: c,
                                selectedCount: selected[c].length,
                                selectedValues: selected[c],
                                isNumeric: (field_types[c] == 'number')
                            });
                        }

                        resolve(result_list);

                    });
                });
            });
        }

    };



    return SharingViaUrl;
})();

if (typeof define === 'function' && define.amd) {
    define(function () {
        return SharingViaUrl;
    });
} else if (typeof module !== 'undefined' && module != null) {
    module.exports = SharingViaUrl;
} else if (typeof angular !== 'undefined' && angular != null) {
    angular.module('SharingViaUrl', [])
        .factory('SharingViaUrl', function () {
            return SharingViaUrl;
        });
}