'use strict';

/**
 * @ngdoc service
 * @name bitbloqApp.exerciseService
 * @description
 * # exerciseService
 * Service in the bitbloqApp.
 */
angular.module('bitbloqApp')
    .service('exerciseService', function($log, $window, envData, $q, $rootScope, _, alertsService, centerModeService, ngDialog, imageApi, common, utils, $translate, bowerData, $timeout, hardwareService, exerciseApi, $route, $location, bloqsUtils, hw2Bloqs, commonModals, arduinoGeneration, centerModeApi) {

        var exports = {},
            savePromise,
            oldExercise = {};

        exports.bloqs = {
            varsBloq: null,
            setupBloq: null,
            loopBloq: null
        };

        exports.componentsArray = [];

        exports.exercise = {};

        var scope = $rootScope.$new(),
            confirmDeleteModal;
        scope.exercise = exports.exercise;

        exports.clone = function(exercise) {
            if (!exercise) {
                exercise = exports.exercise;
                exports.completedExercise();
            }
            commonModals.clone(exercise, true, 'exercise');
        };

        exports.showActivationModal = function(robotFamily) {
            var robotModal = robotFamily ? robotFamily : robotsMap[exports.exercise.hardware.showRobotImage].family;
            commonModals.activateRobot(robotModal).then(function() {
                exports.showActivation = false;
                exports.closeActivation = false;
            });
        };

        exports.getRobotsMap = function(hardwareConstants) {
            var map = {};
            for (var i = 0; i < hardwareConstants.robots.length; i++) {
                map[hardwareConstants.robots[i].uuid] = hardwareConstants.robots[i];
            }
            return map;
        };

        var robotsMap = [];

        hardwareService.itsHardwareLoaded().then(function() {
            robotsMap = exports.getRobotsMap(hardwareService.hardware);
        });

        exports.showActivation = false;
        exports.closeActivation = false;

        exports.completedExercise = function() {
            if (exports.bloqs.varsBloq) {
                exports.exercise.software = {
                    vars: exports.bloqs.varsBloq.getBloqsStructure(),
                    setup: exports.bloqs.setupBloq.getBloqsStructure(),
                    loop: exports.bloqs.loopBloq.getBloqsStructure()
                };
            }

            _updateHardwareSchema();
            _updateHardwareTags();
            exports.exercise.code = exports.getCode();
        };

        exports.download = function(exercise, type) {
            exercise = exports.getCleanExercise(exercise || exports.exercise, true);
            type = type || 'json';
            if (type === 'arduino') {
                _downloadIno(exercise);
            } else {
                _downloadJSON(exercise);
            }

        };

        exports.assignGroup = function(project, teacherId, oldGroups, centerId, onlyEdit) {
            var defered = $q.defer(),
                checkWatchers = [];
            oldGroups = _.groupBy(oldGroups, '_id');
            centerModeApi.getGroups('teacher', null, null, true).then(function(response) {
                var groups = response.data;
                _.forEach(groups, function(group) {
                    group.selected = !!oldGroups[group._id];
                });

                function confirmAction(groups) {
                    var selectedGroups = _.filter(groups, {
                            'selected': true
                        }),
                        groupsToAssign = [],
                        removedGroups = {
                            groupIds: _.map(_.filter(groups, {
                                'selected': false
                            }), '_id'),
                            exerciseId: project._id
                        };

                    selectedGroups.forEach(function(group) {
                        if (group.withoutDate || !group.calendar.from.time || !group.calendar.to.time) {
                            groupsToAssign.push({
                                group: group._id,
                                exercise: project._id
                            });
                        } else {
                            group.calendar.from.date = moment(group.calendar.from.date);
                            group.calendar.to.date = moment(group.calendar.to.date);
                            var hourFrom = group.calendar.from.time.split(':')[0],
                                minutesFrom = group.calendar.from.time.split(':')[1],
                                hourTo = group.calendar.to.time.split(':')[0],
                                minutesTo = group.calendar.to.time.split(':')[1];
                            group.calendar.from.date.hour(hourFrom);
                            group.calendar.from.date.minute(minutesFrom);
                            group.calendar.to.date.hour(hourTo);
                            group.calendar.to.date.minute(minutesTo);

                            groupsToAssign.push({
                                group: group._id,
                                exercise: project._id,
                                initDate: group.calendar.from.date,
                                endDate: group.calendar.to.date
                            });
                        }
                    });

                    exerciseApi.assignGroups(groupsToAssign, removedGroups).then(function(response) {
                        defered.resolve(response.data);
                        assignModal.close();
                        alertsService.add({
                            text: 'centerMode__alert__assignGroup-ok',
                            id: 'centerMode-assignGroup',
                            type: 'info',
                            time: 5000
                        });
                    }).catch(function() {
                        defered.reject();
                        assignModal.close();
                        alertsService.add({
                            text: 'centerMode__alert__assignGroup-error',
                            id: 'centerMode-assignGroup',
                            type: 'warning',
                            time: 5000
                        });
                    });
                }

                var modalOptions = $rootScope.$new(),
                    assignModal;

                function showDatePicker(datePickerId) {
                    setTimeout(function() {
                        $('#' + datePickerId).focus();
                    }, 0);
                }

                function showTimePicker(timePickerId, event) {
                    $('#' + timePickerId).click();
                    event.stopPropagation();
                }

                function getTime(initDate) {
                    var dateString;
                    if (initDate) {
                        var momentDate = moment(initDate),
                            minutes = momentDate.minute();
                        dateString = momentDate.hour() + ':' + (String(minutes).length === 1 ? '0' : '') + minutes;
                    }
                    return dateString;
                }

                function initTimePicker() {
                    var options = {
                        twentyFour: true //Display 24 hour format, defaults to falseç

                    };
                    $('.timepicker').wickedpicker(options);
                }

                function _newGroup() {
                    centerModeService.newGroup(teacherId, centerId).then(function(response) {
                        groups.push(response.data);
                        _.extend(modalOptions, {
                            groups: groups
                        });
                    });
                }

                function allCheckWatchers(groups) {
                    var cloneGroups = _.cloneDeep(groups);
                    _.forEach(groups, function(group, index) {
                        checkWatchers[index] = modalOptions.$watch('groups[' + index + '].selected', function(newVal, oldVal) {
                            if (oldVal && newVal !== oldVal) {
                                var oldGroup = _.find(cloneGroups, function(item) {
                                    return item._id === group._id;
                                });
                                if (oldGroup.selected) {
                                    deleteTaskConfirm(group, index, modalOptions);
                                }
                            }
                        });
                    });
                }

                function deleteAllWatchers() {
                    _.forEach(checkWatchers, function(watcher) {
                        watcher();
                    });
                }

                _.extend(modalOptions, {
                    title: 'centerMode_editGroups',
                    contentTemplate: 'views/modals/centerMode/editGroups.html',
                    mainText: 'centerMode_editGroups_info',
                    exerciseName: project.name,
                    groups: groups,
                    confirmButton: 'save',
                    today: new Date(),
                    showDatePicker: showDatePicker,
                    showTimePicker: showTimePicker,
                    initTimePicker: initTimePicker,
                    newGroup: _newGroup,
                    getTime: getTime,
                    oldGroups: oldGroups,
                    onlyEdit: onlyEdit,
                    rejectButton: 'modal-button-cancel',
                    rejectAction: defered.reject,
                    confirmAction: confirmAction,
                    modalButtons: true
                });

                allCheckWatchers(modalOptions.groups);

                assignModal = ngDialog.open({
                    template: '/views/modals/modal.html',
                    className: 'modal--container modal--assign-group',
                    preCloseCallback: deleteAllWatchers,
                    scope: modalOptions
                });
            });
            return defered.promise;
        };

        exports.getDatetime = function(date, diff) {
            var now = moment(),
                result = '';
            if (date) {
                if (diff) {
                    result = now.diff(date) > 0;
                } else {
                    if (now.diff(date) > 0) {
                        result = common.translate('time_finished');
                    } else {
                        result = moment(date).fromNow();
                    }
                }
            }
            return result;
        };

        exports.saveInMyProjects = function(taskId) {
            exerciseApi.taskToProject(taskId || exports.exercise._id).then(function() {
                alertsService.add({
                    text: 'centerMode__alert__saveInMyProjects',
                    id: 'centerMode-saveInMyProjects',
                    type: 'info',
                    time: 5000
                });
            });
        };

        exports.rename = function() {
            commonModals.rename(exports.exercise, 'exercise').then(exports.startAutosave);
        };

        /**
         * Status of save exercise
         * 0 = Nothing
         * 1 = AutoSaving in progress
         * 2 = Save correct
         * 3 = Saved Error
         * 4 = Dont Allowed to do Save
         * @type {Number}
         */
        exports.saveStatus = 0;

        exports.savingStatusIdLabels = {
            0: '',
            1: 'make-saving',
            2: 'exercise-saved-ok',
            3: 'exercise-saved-ko',
            4: 'exercise-not-allow-to-save',
            5: 'exercise-saved-mark',
            6: 'exercise-saved-ko-delivered',
            7: 'exercise-saved-ko-outTime'
        };

        exports.tempImage = {};

        exports.addComponentInComponentsArray = function(category, newComponent) {
            exports.componentsArray[category].push(newComponent);
        };

        exports.removeComponentInComponentsArray = function(category, componentName) {
            _.remove(exports.componentsArray[category], {
                name: componentName
            });
        };

        exports.isEmptyComponentArray = function() {
            return _.isEqual(exports.componentsArray, bloqsUtils.getEmptyComponentsArray());
        };

        exports.checkPublish = function(type) {
            var defered = $q.defer();
            type = type || '';
            var exerciseEmptyName = common.translate('new-exercise');
            if (!exports.exercise.name || exports.exercise.name === exerciseEmptyName) {
                if (!exports.exercise.description) {
                    alertsService.add({
                        text: 'publishProject__alert__nameDescriptionError' + type,
                        id: 'publishing-project',
                        type: 'warning'
                    });
                } else {
                    alertsService.add({
                        text: 'publishProject__alert__nameError' + type,
                        id: 'publishing-project',
                        type: 'warning'
                    });
                }
                exports.exercise.name = exerciseEmptyName ? '' : exports.exercise.name;
                defered.reject();
            } else if (!exports.exercise.description) {
                alertsService.add({
                    text: 'publishProject__alert__descriptionError' + type,
                    id: 'publishing-project',
                    type: 'warning'
                });
                defered.reject();
            } else {
                defered.resolve();
            }
            return defered.promise;
        };

        exports.findComponentInComponentsArray = function(myUid) {
            var myComponent;
            _.forEach(exports.componentsArray, function(element) {
                var tmpComponent = _.find(element, function(item) {
                    return item.uid === myUid;
                });
                if (tmpComponent) {
                    myComponent = tmpComponent;
                }
            });
            return myComponent;
        };

        exports.getBoardMetaData = function() {
            return _.find(common.userHardware.boards, function(board) {
                return (board.uuid === exports.exercise.hardware.board || board.name === exports.exercise.hardware.board);
            });
        };

        exports.getRobotMetaData = function(robotId) {
            robotId = robotId || exports.exercise.hardware.robot;
            hardwareService.itsHardwareLoaded().then(function() {
                return _.find(hardwareService.hardware.robots, function(robot) {
                    return robot.id === robotId;
                });
            });
        };

        exports.getCleanExercise = function(exerciseRef, download) {
            exerciseRef = exerciseRef || exports.exercise;
            var cleanExercise = _.cloneDeep(exerciseRef);
            if (download) {
                delete cleanExercise._id;
            }
            delete cleanExercise.creator;
            delete cleanExercise.teacher;
            delete cleanExercise.createdAt;
            delete cleanExercise.updatedAt;
            delete cleanExercise.links;
            delete cleanExercise.__v;
            return cleanExercise;
        };

        exports.getCode = function() {
            var code;
            _updateHardwareSchema();
            var wirelessComponents = _getWirelessConnectionComponents ();
            if (wirelessComponents.length > 0) {
                _includeComponents(wirelessComponents);
            }
            var hardware = _.cloneDeep(exports.exercise.hardware);
            if (exports.exercise.useBitbloqConnect && exports.exercise.hardware.board === 'bqZUM' && exports.exercise.bitbloqConnectBT) {
                hardware.components.push(exports.exercise.bitbloqConnectBT);
            }

            code = arduinoGeneration.getCode({
                varsBloq: exports.bloqs.varsBloq.getBloqsStructure(true),
                setupBloq: exports.bloqs.setupBloq.getBloqsStructure(true),
                loopBloq: exports.bloqs.loopBloq.getBloqsStructure(true)
            }, hardware);
            return code;
        };

        exports.getDefaultExercise = function() {
            var exercise = {
                creator: '',
                name: common.translate('new-exercise'),
                description: '',
                hardwareTags: [],
                defaultTheme: 'infotab_option_colorTheme',
                selectedBloqs: {},
                software: {
                    vars: {
                        enable: true,
                        name: 'varsBloq',
                        childs: [],
                        content: [
                            []
                        ]
                    },
                    setup: {
                        enable: true,
                        name: 'setupBloq',
                        childs: [],
                        content: [
                            []
                        ]
                    },
                    loop: {
                        enable: true,
                        name: 'loopBloq',
                        childs: [],
                        content: [
                            []
                        ]
                    },
                    freeBloqs: []
                },
                hardware: {
                    board: null,
                    robot: null,
                    components: [],
                    connections: []
                }
            };

            return exercise;
        };

        exports.getSavePromise = function() {
            return savePromise;
        };

        exports.getSavingStatusIdLabel = function() {
            return exports.savingStatusIdLabels[exports.saveStatus];
        };

        exports.isShared = function(exercise) {
            var found = false,
                i = 0,
                propertyNames = Object.getOwnPropertyNames(exercise._acl);
            while (!found && (i < propertyNames.length)) {
                if (propertyNames[i] !== 'ALL' && common.user && propertyNames[i].split('user:')[1] !== common.user._id) {
                    found = true;
                }
                i++;
            }
            return found;
        };

        exports.initBloqsExercise = function(watchers) {
            exports.exercise = _.extend(exports.exercise, exports.getDefaultExercise());
            exports.setComponentsArray();
            if (watchers) {
                exports.addWatchers();
            }
        };

        exports.exerciseHasChanged = function() {
            var identicalExerciseObject = _.isEqual(exports.exercise, oldExercise);
            return !identicalExerciseObject || (exports.tempImage.file);
        };

        exports.saveOldExercise = function() {
            oldExercise = _.cloneDeep(exports.exercise);
        };

        exports.setComponentsArray = function(components) {
            if (components) {
                exports.componentsArray = components;
            } else {
                exports.componentsArray = bloqsUtils.getEmptyComponentsArray();
                if (!exports.exercise.hardware.components) {
                    exports.exercise.hardware.components = [];
                    exports.exercise.hardware.connections = [];
                }
                exports.exercise.hardware.components.forEach(function(comp) {
                    if (comp.oscillator === true || comp.oscillator === 'true') {
                        exports.componentsArray.oscillators.push(_.cloneDeep(comp));
                    } else {
                        exports.componentsArray[comp.category].push(_.cloneDeep(comp));
                    }
                });

                if (exports.exercise.useBitbloqConnect && (exports.exercise.hardware.board === 'bqZUM') && exports.exercise.bitbloqConnectBT) {
                    exports.addComponentInComponentsArray('serialElements', exports.exercise.bitbloqConnectBT);
                }
            }
        };
        ///temp fix to code refactor, sensor types
        var sensorsTypes = {};
        var sensorsArray = [];
        hardwareService.itsHardwareLoaded().then(function() {
            sensorsArray = _.filter(hardwareService.hardware.components, {
                category: 'sensors'
            });
        });

        for (var i = 0; i < sensorsArray.length; i++) {
            sensorsTypes[sensorsArray[i].uuid] = sensorsArray[i].dataReturnType;
        }

        exports.setExercise = function(newExercise) {
            for (var i = 0; i < newExercise.hardware.components.length; i++) {
                if (newExercise.hardware.components[i].category === 'sensors') {
                    newExercise.hardware.components[i].dataReturnType = sensorsTypes[newExercise.hardware.components[i].uuid];
                }
            }
            //end temp fix

            if (_.isEmpty(exports.exercise)) {
                exports.exercise = exports.getDefaultExercise();
            }
            _.extend(exports.exercise, newExercise);
            exports.setComponentsArray();
            exports.addWatchers();
        };

        exports.startAutosave = function(hard) {
            if (!exports.exercise._id || exports.exercise.userCanUpdate || exports.exercise.canMark) {
                if (common.user) {
                    exports.saveStatus = 1;
                    if (hard) {
                        savePromise = _saveExercise();
                    } else if (!savePromise || (savePromise.$$state.status !== 0)) {
                        savePromise = $timeout(_saveExercise, envData.config.saveTime || 10000);
                        return savePromise;
                    }
                } else {
                    exports.completedExercise();
                    common.session.exercise = _.cloneDeep(exports.exercise);
                    common.session.save = true;
                }
            }
        };

        //---------------------------------------------------------------------
        //---------------------------------------------------------------------
        //----------------- api communication ---------------------------------
        //---------------------------------------------------------------------
        //---------------------------------------------------------------------

        exports.getExerciseOrTask = function(id) {
            if (common.section === 'task') {
                return exerciseApi.getTask(id);
            } else {
                return exerciseApi.get(id);
            }
        };

        function _updateExerciseOrTask(exerciseId, exercise) {
            if (common.section === 'task') {
                return exerciseApi.updateTask(exerciseId, exercise);
            } else {
                return exerciseApi.update(exerciseId, exercise);
            }
        }

        //---------------------------------------------------------------------
        //---------------------------------------------------------------------
        //----------------- Private functions ---------------------------------
        //---------------------------------------------------------------------
        //---------------------------------------------------------------------

        function _downloadIno(exercise, code) {
            code = code || exercise.code;
            var name = exercise.name;
            //Remove all diacritics
            name = utils.removeDiacritics(name, undefined, $translate.instant('new-exercise'));

            utils.downloadFile(name.substring(0, 30) + '.ino', code, 'text/plain;charset=UTF-8');
        }

        function _downloadJSON(exerciseRef) {
            exerciseRef = exerciseRef || exports.exercise;
            var exercise = exports.getCleanExercise(exerciseRef, true);
            exercise.bloqsVersion = bowerData.dependencies.bloqs;

            var filename = utils.removeDiacritics(exercise.name, undefined, $translate.instant('new-exercise'));

            utils.downloadFile(filename.substring(0, 30) + '.bitbloq', JSON.stringify(exercise), 'application/json');
        }

        function _getWirelessConnectionComponents (){
            var wirelessComponentArray = [];
            _.forEach(exports.componentsArray, function(component){
                var wirelessComponent = _.filter(component, {wirelessConnection: true});
                if(wirelessComponent.length > 0){
                    wirelessComponentArray.push(wirelessComponent);
                }
            });
            return _.flattenDeep(wirelessComponentArray);
        }

        function _includeComponents(components) {
            _.forEach(components, function(component){
                exports.project.hardware.components.push(component);
            });
        }

        function _init() {
            var def = $q.defer();
            savePromise = def.promise;
            def.resolve();
        }

        function _saveExercise() {
            var defered = $q.defer();
            exports.completedExercise();
            if (exports.exercise.canMark) {
                if (exports.exercise.newMark || exports.exercise.newRemark) {
                    var newMark = _.join(exports.exercise.newMark, '.');
                    if (newMark === String(exports.exercise.mark) && exports.exercise.newRemark === exports.exercise.remark) {
                        exports.saveStatus = 4;
                    } else {
                        exerciseApi.markTask(exports.exercise).then(function() {
                            exports.exercise.mark = newMark;
                            exports.exercise.remark = exports.exercise.newRemark;
                            exports.saveStatus = 5;
                            defered.resolve();
                        }).catch(function() {
                            exports.saveStatus = 3;
                            defered.reject();
                        });
                    }
                } else {
                    exports.saveStatus = 0;
                    defered.resolve();
                }
            } else {
                if (exports.exerciseHasChanged() || exports.tempImage.file) {

                    exports.exercise.name = exports.exercise.name || common.translate('new-exercise');

                    $log.debug('Auto saving exercise...');

                    if (exports.tempImage.file && !exports.tempImage.generate) {
                        exports.exercise.image = 'custom';
                    }

                    if (exports.exercise._id) {
                        if ((common.userRole === 'teacher' && (exports.exercise.teacher === common.user._id || exports.exercise.teacher._id === common.user._id)) ||
                            (common.userRole === 'headmaster' && (exports.exercise.creator === common.user._id || exports.exercise.creator._id === common.user._id || exports.exercise.teacher === common.user._id))) {
                            return _updateExerciseOrTask(exports.exercise._id, exports.getCleanExercise())
                                .then(function() {
                                    exports.saveStatus = 2;
                                    exports.saveOldExercise();
                                    localStorage.exercisesChange = true;
                                    if (exports.tempImage.file) {
                                        imageApi.save(exports.exercise._id, exports.tempImage.file, 'exercise')
                                            .then(function() {
                                                exports.tempImage = {};
                                            });
                                    }
                                });
                        }
                        if (common.userRole === 'student' && exports.exercise.student === common.user._id) {
                            if (exports.exercise.status === 'delivered') {
                                exports.saveStatus = 6;
                                defered.reject();
                            } else {
                                var now = moment(),
                                    date = moment(exports.exercise.endDate);
                                if (!exports.exercise.endDate || date.diff(now) >= 0) {
                                    return exerciseApi.updateTask(exports.exercise._id, exports.getCleanExercise())
                                        .then(function() {
                                            exports.saveStatus = 2;
                                            exports.saveOldExercise();
                                            localStorage.exercisesChange = true;
                                            if (exports.tempImage.file) {
                                                imageApi.save(exports.exercise._id, exports.tempImage.file, 'exercise')
                                                    .then(function() {
                                                        exports.tempImage = {};
                                                    });
                                            }
                                        });
                                } else {
                                    exports.saveStatus = 7;
                                    defered.reject();
                                }
                            }
                        } else {
                            exports.saveStatus = 4;
                            defered.reject();
                        }
                    } else {
                        if (common.user) {
                            exports.exercise.creator = common.user._id;
                            return exerciseApi.save(exports.getCleanExercise()).then(function(response) {
                                exports.saveStatus = 2;
                                exports.exercise.userCanUpdate = true;
                                var idExercise = response.data;
                                exports.exercise._id = idExercise;
                                exports.exercise.teacher = common.user._id;
                                //to avoid reload
                                $route.current.pathParams.id = idExercise;
                                $location.url('/exercise/' + idExercise);

                                common.isLoading = false;
                                if (localStorage.exercisesChange) {
                                    localStorage.exercisesChange = !JSON.parse(localStorage.exercisesChange);
                                }
                                exports.saveOldExercise();

                                if (exports.tempImage.file) {
                                    imageApi.save(idExercise, exports.tempImage.file, 'exercise').then(function() {
                                        $log.debug('imageSaveok');
                                        localStorage.exercisesChange = true;
                                        exports.tempImage = {};
                                    });
                                }
                            }).catch(function() {
                                exports.saveStatus = 3;
                                defered.reject();
                            });
                        } else {
                            exports.saveStatus = 0;
                            $log.debug('why we start to save if the user its not logged??, check startAutoSave');
                            defered.reject();
                        }
                    }
                } else {
                    $log.debug('we cant save Exercise if there is no changes');
                    exports.saveStatus = 0;
                    defered.resolve();
                }
            }

            return defered.promise;
        }

        function _updateHardwareSchema() {
            var schema = hw2Bloqs.saveSchema();
            if (schema) { //If exercise is loaded on protocanvas
                schema.components = schema.components.map(function(elem) {
                    var newElem = exports.findComponentInComponentsArray(elem.uid);
                    if (newElem) {
                        newElem = _.extend(newElem, elem);
                    }
                    return newElem;
                });

                exports.exercise.hardware.connections = _.cloneDeep(schema.connections);

                //concat integrated hardware and connected hardware
                exports.exercise.hardware.components = _.filter(exports.exercise.hardware.components, {
                    integratedComponent: true
                }).concat(schema.components);
            }
        }

        function _updateHardwareTags() {
            var newHardwareTags = [];
            var mainTag = exports.exercise.hardware.robot || exports.exercise.hardware.board;
            if (mainTag) {
                newHardwareTags.push(mainTag);
            }
            if (exports.exercise.bitbloqConnectBT) {
                newHardwareTags.push('Bitbloq Connect');
            }
            exports.exercise.hardware.components.forEach(function(comp) {
                newHardwareTags.push(comp.id);
            });
            if (exports.exercise.useBitbloqConnect) {
                newHardwareTags.push('bitbloqconnect');
            }
            exports.exercise.hardwareTags = _.uniq(newHardwareTags);
        }

        function deleteTaskConfirm(group, index, scope) {
            var parent = $rootScope,
                modalOptions = parent.$new();

            function checkGroup() {
                scope.groups[index].selected = true;
                confirmDeleteModal.close();
            }

            function unCheckGroup() {
                scope.groups[index].selected = false;
                confirmDeleteModal.close();

            }

            _.extend(modalOptions, {
                title: 'unassignGroup_modal_title',
                confirmButton: 'unassignGroup_modal_acceptButton',
                confirmAction: unCheckGroup,
                rejectButton: 'modal-button-cancel',
                rejectAction: checkGroup,
                textContent: common.translate('unassignGroup_modal_info', {
                    value: group.name
                }),
                contentTemplate: '/views/modals/information.html',
                modalButtons: true
            });

            confirmDeleteModal = ngDialog.open({
                template: '/views/modals/modal.html',
                className: 'modal--container modal--input',
                scope: modalOptions
            });
        }

        /*************************************************
         init functions and watchers
         *************************************************/
        _init();

        exports.addWatchers = function() {
            scope.$watch('exercise.name', function(newVal, oldVal) {
                if (newVal !== oldVal) {
                    exports.exercise.name = exports.exercise.name || common.translate('new-exercise');
                    exports.startAutosave();
                }
            });

            scope.$watch('exercise.description', function(newVal, oldVal) {
                if (newVal !== oldVal) {
                    if (!newVal) {
                        exports.exercise.description = '';
                    }
                    exports.startAutosave();
                }
            });

            scope.$watch('exercise.hardware.board', function(newVal, oldVal) {
                if (newVal !== oldVal) {
                    exports.startAutosave();
                }
            });

            scope.$watch('exercise.newMark[0]', function(newVal, oldVal) {
                if (newVal !== oldVal && newVal !== String(exports.exercise.mark).split('.')[0]) {
                    exports.startAutosave();
                }
            });

            scope.$watch('exercise.newMark[1]', function(newVal, oldVal) {
                if (newVal !== oldVal && newVal !== String(exports.exercise.mark).split('.')[1]) {
                    exports.startAutosave();
                }
            });

            scope.$watch('exercise.newRemark', function(newVal, oldVal) {
                if (newVal && newVal !== oldVal && newVal !== exports.exercise.remark) {
                    exports.startAutosave();
                }
            });
        };

        $rootScope.$on('$locationChangeStart', function(event) {
            if (exports.saveStatus === 1) {
                var answer = $window.confirm($translate.instant('leave-without-save') + '\n\n' + $translate.instant('leave-page-question'));
                if (!answer) {
                    event.preventDefault();
                }
            }
        });
        return exports;
    });