////////////////////////////////////////////////////////////////
//                  設定のリセット機能
////////////////////////////////////////////////////////////////
$(document).on("click", "#reset", function(){
    $("#reset_modal_bg").fadeIn();
});
$(document).on("click", "#reset_back", function(){
    $("#reset_modal_bg").fadeOut();
});
$(document).on("click", "#reset_button", function(){
    localStorage.clear();
    location.reload();
});


////////////////////////////////////////////////////////////////
//                  音声認識
////////////////////////////////////////////////////////////////
window.SpeechRecognition = window.SpeechRecognition || webkitSpeechRecognition;
var recognition = new webkitSpeechRecognition();
recognition.lang = 'ja';

// 録音取得時トリガー
recognition.addEventListener('result', function(event){
    var text = event.results.item(0).item(0).transcript;
    text = text.replace(" ", "");
    $("#mic").removeClass("record");
    if (text.length > 13){
        var view_text = text.slice(0, 13) + '…';
    }else{
        var view_text = text;
    }
    $(".arrow_box").text(view_text);
    if(command2idx[view_text] != undefined){
        play_action(command2idx[view_text]);
    }
}, false);

// 録音終了時トリガー
recognition.addEventListener('end', function(event){
    $("#mic").removeClass("record");
    if ($(".arrow_box").text() == "コマンド受付中"){
        $(".arrow_box").text("入力なし");
    }
}, false);

// 録音開始
function record(){
    recognition.start();
}

// コマンドの受付
$(document).on("click", "#mic", function(){
    if ($(this).hasClass("record")){
        return;
    }
    $(this).addClass("record");
    $(".arrow_box").css("display", "block").text("コマンド受付中");
    record();
});


////////////////////////////////////////////////////////////////
//                  Three.js関連
////////////////////////////////////////////////////////////////
// THREE.jsで制御する変数
var arToolkitSource = null, arToolkitContext = null;
var renderer, scene;
var markerRoot, smoothedRoot, arWorldRoot;
var artoolkitMarker, smoothedControls;
var stats, helper, mesh, plane, wall;
var summon_field;
var camera, ambient, directionalLight;
var onRenderFcts;
var timer, lastTimeMsec = null, destroy = false;
var ready;
var clock = new THREE.Clock(), oldTime;
var action_root;

// MMDのパラメータ
var mmdStatus = {
    summon: false, 
    inAnimation: false,
    modelName: '', 
    modelIndex: 0, 
    modeName: '',
    modeIndex: 0, 
    motionName: '',
    motionIndex: 0, 
    changeMotion: false,    // ここがtrueになった瞬間モーションが切り替わり始める
    changeModeName:'',      // 切り替え先のモード
    changeMotionName:'',    // 切り替え先のモーション
    changeMotionIndex: 0    // 切り替え先のモーションインデックス
};

function set_mmd_param(modelIndex, modeIndex, motionIndex){
    mmdStatus["modelIndex"] = modelIndex;
    mmdStatus["modelName"] = modelParams[modelIndex].name;
    mmdStatus["modeIndex"] = modeIndex;
    mmdStatus["modeName"] = motionParams[modeIndex].name;
    mmdStatus["motionIndex"] = motionIndex;
    mmdStatus["motionName"] = motionParams[modeIndex]["motions"][motionIndex].name;
}

var modelParams = [];
var motionParams = [{name: 'music', motions: []}]//, {name: 'action', motions: []}];   // [{name:filename, vmd:vmdpath, video_id:id, title:title, img:img, dir:dir}, ...]
var command2idx = {};

// 初期化
function init_three(){
    // webGL renderer
    if (getOS() != "Android"){
        renderer	= new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
    }else{
        renderer	= new THREE.WebGLRenderer({
            alpha: true
        });
    }
    renderer.shadowMap.enabled = true;
    renderer.setClearColor(new THREE.Color('lightgrey'), 0.0);
    //renderer.setPixelRatio( 1.5 );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = 0;
    document.getElementById('mmd').appendChild(renderer.domElement);
    // array of functions for the rendering loop
    onRenderFcts = [];
    // init scene and camera
    scene	= new THREE.Scene();
    // create a camera
    camera = new THREE.Camera();
    ambient = new THREE.AmbientLight( 0x666666 );
    scene.add( ambient );
    directionalLight = new THREE.DirectionalLight( 0x887766, 1.0 );
    directionalLight.position.set( -1, 1, 2 ).normalize();
    directionalLight.castShadow = true;
    if (getOS() != "Android"){
        directionalLight.shadowMapWidth = 2048; // これ!
        directionalLight.shadowMapHeight = 2048; // これ!
    }
    scene.add( directionalLight );
    // handle arToolkitSource
    arToolkitSource = new THREEx.ArToolkitSource({
        sourceType : 'webcam'
    })
    arToolkitSource.init(function onReady(){
        onResize();
    })
    // create atToolkitContext
    arToolkitContext = new THREEx.ArToolkitContext({
        cameraParametersUrl: 'data/camera_para.dat',
        detectionMode: 'mono',
        imageSmoothingEnabled: true,
        maxDetectionRate: 30,
        canvasWidth: 80*3,
        canvasHeight: 60*3
    })
    // initialize it
    arToolkitContext.init(function onCompleted(){
        camera.projectionMatrix.copy( arToolkitContext.getProjectionMatrix() );
    })
    // update artoolkit on every frame
    onRenderFcts.push(function(){
        if( arToolkitSource.ready === false )	return;
        arToolkitContext.update( arToolkitSource.domElement );
    })
    // create a ArMarkerControls
    markerRoot = new THREE.Group;
    scene.add(markerRoot);
    artoolkitMarker = new THREEx.ArMarkerControls(arToolkitContext, markerRoot, {
        size: 1, 
        type : 'pattern',
        patternUrl : 'data/marker16.pat', 
        minConfidence : 0.5
    });
    // build a smoothedControls
    smoothedRoot = new THREE.Group();
    scene.add(smoothedRoot);
    smoothedControls = new THREEx.ArSmoothedControls(smoothedRoot, {
        lerpPosition: 0.4,
        lerpQuaternion: 0.3,
        lerpScale: 1,
    });
    onRenderFcts.push(function(delta){
        smoothedControls.update(markerRoot);
    });

    // add an object in the scene
    arWorldRoot = smoothedRoot;

    // add helper
    // gridHelper = new THREE.GridHelper(30, 50);  // 引数は サイズ、1つのグリッドの大きさ
    // arWorldRoot.add(gridHelper);
    // axisHelper = new THREE.AxisHelper(10);  // 引数は 軸のサイズ
    // arWorldRoot.add(axisHelper);

    // 影の描画
    plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({opacity: 0.5}));
    //plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshLambertMaterial({color: "black"}));
    plane.rotation.x = -90 * Math.PI / 180;
    plane.receiveShadow = true; 
    arWorldRoot.add(plane);

    var invisible_material = new THREE.MeshBasicMaterial({
        color: 0x000000,
        opacity: 0.0,
        side: THREE.DoubleSide
    });
    var invisible_plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), invisible_material);
    invisible_plane.rotation.x = -90 * Math.PI / 180;
    arWorldRoot.add(invisible_plane);

    // 召喚演出 https://github.com/ics-creative/160304_threejs_save_point を参考にする
    summon_field = new THREE.Group();
    // 光の柱
    var light_sylinder_geometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 25, 25, true);
    var light_sylinder_texture = THREE.ImageUtils.loadTexture("img/pillar.png");
    light_sylinder_texture.wrapS = THREE.RepeatWrapping;
    light_sylinder_texture.repeat.set(10, 1);
    var light_sylinder_material = new THREE.MeshBasicMaterial({
        map: light_sylinder_texture,           // テクスチャーを指定
        opacity: 0, 
        color: 0x007eff,        // 色
        transparent: true,      // 透明の表示許可
        blending: THREE.AdditiveBlending, // ブレンドモード
        side: THREE.DoubleSide, // 表裏の表示設定
        depthWrite: false       // デプスバッファへの書き込み可否
    });
    var light_sylinder_mesh = new THREE.Mesh(light_sylinder_geometry, light_sylinder_material);
    light_sylinder_mesh.position.set(0, 1, 0);
    // 光の柱 2
    var light2_sylinder_geometry = new THREE.CylinderGeometry(1.2, 0.89, 0.6, 25, 25, true);
    var light2_sylinder_texture = THREE.ImageUtils.loadTexture("img/pillar.png");
    light2_sylinder_texture.wrapS = THREE.RepeatWrapping;
    light2_sylinder_texture.repeat.set(10, 1);
    var light2_sylinder_material = new THREE.MeshBasicMaterial({
        map: light2_sylinder_texture,           // テクスチャーを指定
        color: 0x007eff,        // 色
        opacity: 0, 
        transparent: true,      // 透明の表示許可
        blending: THREE.AdditiveBlending, // ブレンドモード
        side: THREE.DoubleSide, // 表裏の表示設定
        depthWrite: false       // デプスバッファへの書き込み可否
    });
    var light2_sylinder_mesh = new THREE.Mesh(light2_sylinder_geometry, light2_sylinder_material);
    light2_sylinder_mesh.position.set(0, 0.3, 0);
    // 渦
    var swirl_geometry = new THREE.TorusGeometry(0.8, 0.3, 2, 100 );
    var swirl_texture = THREE.ImageUtils.loadTexture("img/swirl2.png");
    swirl_texture.offset.y = -0.25;
    swirl_texture.wrapS = THREE.RepeatWrapping;
    var swirl_material = new THREE.MeshBasicMaterial({
        color: 0x007eff,
        map: swirl_texture,
        opacity: 0, 
        transparent: true,
        blending: THREE.AdditiveBlending
        //wireframe: true,
    });
    var swirl_mesh = new THREE.Mesh(swirl_geometry, swirl_material);
    swirl_mesh.position.y = 0.012;
    swirl_mesh.rotation.x = 90 * Math.PI / 180;
    // 地面の光
    var groundTexture = THREE.ImageUtils.loadTexture("img/ground.png");
    var ground = new THREE.Mesh(
            new THREE.PlaneGeometry(1.78, 1.78, 32, 32),
            new THREE.MeshBasicMaterial({
                //color: 0x007eff,
                color: 0xffffff,
                opacity: 0, 
                map: groundTexture,
                side: THREE.DoubleSide,
                transparent: true,
                blending: THREE.AdditiveBlending
            })
            );
    ground.scale.multiplyScalar(1.35);
    ground.rotation.x = 90 * Math.PI / 180;
    ground.position.set(0, 0.02, 0);

    // 召喚陣アニメーション
    onRenderFcts.push(function(delta){
        if (summon_field.visible == true){
            let angle = 20 * clock.elapsedTime * Math.PI / 180;
            light_sylinder_texture.offset.y = 0.1 + 0.2 * Math.sin(angle*3);
            light_sylinder_texture.offset.x = angle;
            light2_sylinder_texture.offset.y = 0.1 + 0.2 * Math.sin(angle*3);
            light2_sylinder_texture.offset.x = angle;
            swirl_texture.offset.x = -angle * 0.2;
        }
    });

    summon_field.add(light_sylinder_mesh);
    summon_field.add(light2_sylinder_mesh);
    summon_field.add(swirl_mesh);
    summon_field.add(ground);
    arWorldRoot.add(summon_field);

    // add MMD
    var onProgress = function ( xhr ) {
        if ( xhr.lengthComputable ) {
            var percentComplete = xhr.loaded / xhr.total * 100;
            console.log( Math.round(percentComplete, 2) + '% downloaded' );
            $("load_console").text(Math.round(percentComplete, 2) + '% loaded');
        }
    };
    var onError = function ( xhr ) {
    };
    helper = new THREE.MMDHelper();
    ready = false;
    var loader = new THREE.MMDLoader();

    // モーションファイルをロードする
    function loadVmds ( mesh, callback ) {
        function load ( paramIndex, motionIndex ) {     // モーションを再帰的にロードする
            if ( paramIndex >= motionParams.length ) {
                callback();
                return;
            }
            var param = motionParams[ paramIndex ];
            console.log("load" , param.motions[motionIndex].name);
            $("#load_console").text("load " + param.motions[motionIndex].name)
            loader.loadVmds( [param.motions[motionIndex].vmd], function ( vmd ) {
                loader.pourVmdIntoModel( mesh, vmd, param.name + motionIndex );
                motionIndex++;
                if ( motionIndex >= param.motions.length ) {
                    paramIndex++;
                    motionIndex = 0;
                }
                load( paramIndex, motionIndex );
            }, onProgress, onError );
        }
        load( 0, 0 );       
    }

    loader.loadModel( modelParams[mmdStatus.modelIndex].file, function ( object ) {
        mesh = object;
        // 召喚モーション
        mmdStatus.summon = false;
        oldTime = null;
        onRenderFcts.push(function(){
            if (mmdStatus.summon == true){
                return;
            }
            if (oldTime){
                var diff_time = (clock.oldTime-oldTime)/3000;
                oldTime = clock.oldTime;
                var model_summon_ready = mesh.position.y >= 0;
                var opacity_zero = true;
                if (model_summon_ready == false){
                    for (var i in summon_field.children){
                        if (summon_field.children[i].material.opacity < 1){
                            summon_field.children[i].material.opacity += 2*diff_time;
                        }
                    }
                }
                if (mesh.position.y < 0){
                    mesh.position.y += diff_time;
                }else if (mesh.position.y >= 0){
                    mesh.position.y = 0;
                    for (var i in summon_field.children){
                        summon_field.children[i].material.opacity -= 2*diff_time;
                        if (summon_field.children[i].material.opacity > 0){
                            opacity_zero = false;
                        }
                    }
                    if (opacity_zero == true){
                        mmdStatus.summon = true;
                        summon_field.visible = false;
                    }
                }
            }else{
                oldTime = clock.oldTime;
                new Audio('audio/summon.mp3').play(); 
            }
        });

        // モデルのロード
        var modelLoadEnd = function(_mesh) {
            loadVmds( _mesh, function () {
                _mesh.castShadow = true; 
                _mesh.position.y = -2;
                arWorldRoot.add( _mesh );
                helper.add( _mesh );
                helper.setAnimation( _mesh );
                helper.setPhysics( _mesh );
                helper.unifyAnimationDuration( { afterglow: 2.0 } );
                for (let i in motionParams){
                    var mode_name = motionParams[i].name;
                    var motions = motionParams[i].motions;
                    for (let j in motions){
                        var c_name = mode_name + String(j);
                        if (_mesh.mixer.clipAction( c_name )){
                            _mesh.mixer.clipAction( c_name ).clampWhenFinished = true;     //モーション終了時に固定する
                            _mesh.mixer.clipAction( c_name ).weight = 0;
                            _mesh.mixer.clipAction( c_name ).time = 0;  
                            _mesh.mixer.clipAction( c_name ).play();               // 一瞬だけ再生しておく必要がある
                            _mesh.mixer.clipAction( c_name ).paused = true;
                        }
                        if (_mesh.mixer.clipAction( c_name + 'Morph' )){
                            _mesh.mixer.clipAction( c_name + 'Morph' ).clampWhenFinished = true;  
                            _mesh.mixer.clipAction( c_name + 'Morph' ).weight = 0;  
                            _mesh.mixer.clipAction( c_name + 'Morph' ).time = 0;
                            _mesh.mixer.clipAction( c_name + 'Morph' ).play();
                            _mesh.mixer.clipAction( c_name + 'Morph' ).paused = true;
                        }
                    }
                }
                //if(arToolkitSource.ready == true){
                    console.log("draw mmd model");
                    $("load_console").text("draw mmd model");
                    ready = true;
                    $("#menu_button").css("display", "block");
                    $("#mic").css("display", "block");
                    $("#mode_button").css("display", "flex");
                    $("#load_bg").css("z-index", "-10");
                    init_pause();
                    start_render();
                //}
            });
        };
        setTimeout(modelLoadEnd(mesh), 10);
    }, onProgress, onError );

    // モーションの切り替え
    onRenderFcts.push(function(){
        if (mmdStatus.changeMotion == true){
            var fromName = mmdStatus.modeName + mmdStatus.motionIndex;
            var toName = mmdStatus.changeModeName + mmdStatus.changeMotionIndex;
            if (fromName == toName){
                if (mesh.mixer.clipAction( toName )){
                    mesh.mixer.clipAction( toName ).time = 0;   
                }
                if (mesh.mixer.clipAction( toName + 'Morph' )){
                    mesh.mixer.clipAction( toName + "Morph" ).time = 0;   
                }
                mmdStatus.changeMotion = false;
                return;
            }
            console.log("change motion", fromName, "->", toName);
            if (mesh.mixer.clipAction( fromName )){
                mesh.mixer.clipAction( fromName ).weight -= 0.1;
            }
            if (mesh.mixer.clipAction( toName )){
                mesh.mixer.clipAction( toName ).time = 0;   
                mesh.mixer.clipAction( toName ).weight += 0.1;
            }
            if (mesh.mixer.clipAction( fromName + 'Morph' )){
                mesh.mixer.clipAction( fromName + "Morph" ).weight -= 0.1;
            }
            if (mesh.mixer.clipAction( toName + 'Morph' )){
                mesh.mixer.clipAction( toName + "Morph" ).time = 0;   
                mesh.mixer.clipAction( toName + "Morph" ).weight += 0.1;
            }
            if (mesh.mixer.clipAction( fromName ).weight <= 0){
                mesh.mixer.clipAction( fromName ).paused = true;
                if (mesh.mixer.clipAction( fromName + 'Morph' )){
                    mesh.mixer.clipAction( fromName + 'Morph' ).paused = true;
                }
                mmdStatus.index = mmdStatus.changeMotionIndex;
                mmdStatus.modeName = mmdStatus.changeModeName;
                mmdStatus.motionName = mmdStatus.changeMotionName;
                mmdStatus.motionIndex = mmdStatus.changeMotionIndex;
                mmdStatus.changeMotion = false;
            }
        }
    });

    // render the scene
    onRenderFcts.push(function(){
        if (ready) {
            //console.log(-artoolkitMarker.object3d.rotation.y);
            renderer.render( scene, camera );
            stats.update();
            mesh.scale.set(1.0, 1.0, 1.0);
            var parent = mesh.parent;
            if (parent){
                parent.remove(mesh);
                mesh.updateMatrixWorld(true);
                helper.animate(clock.getDelta());
                mesh.scale.set(0.08, 0.08, 0.08);
                parent.add(mesh);
                mesh.updateMatrixWorld(true);
            }
        }
    })
}

// レンダリング
function start_render(){
    timer = requestAnimationFrame(function animate(nowMsec){
        if (destroy == true){
            cancelAnimationFrame(timer);
            destroy = false;
        }else{
            // keep looping[
            setTimeout( function() {
                timer = requestAnimationFrame( animate );
            },  1000 / 30 );                                        // FPS
            // measure time
            lastTimeMsec	= lastTimeMsec || nowMsec-1000/60;
            var deltaMsec	= Math.min(200, nowMsec - lastTimeMsec);
            lastTimeMsec	= nowMsec;
            // call each update function
            onRenderFcts.forEach(function(onRenderFct){
                onRenderFct(deltaMsec/1000, nowMsec/1000);
            })
        }
    })
}

// 消去
function destroy_three(){
    console.log("destroy 3D scene");
    destroy = true;
    arToolkitSource = null;
    arToolkitContext = null;
    renderer = null;
    scene = null;
    markerRoot = null;
    smoothedRoot = null;
    arWorldRoot = null;
    artoolkitMarker = null;
    smoothedControls = null;
    helper = null; 
    mesh = null;
    plane = null;
    camera = null;
    ambient = null;
    directionalLight = null;
    onRenderFcts = null;
    timer = null;
    lastTimeMsec = null;
    ready = null;
    $("#mmd").children().remove();
    $("video").remove();
    $("#menu_button").css("display", "none");
    $("#mode_button").css("display", "none");
    $("#mic").css("display", "none");
    $(".arrow_box").css("display", "none");
    $("#load_bg").css("z-index", "0");
}

// 初期描画
function draw_mmd(is_init){
    if (is_init == true){
        set_mmd_param(0, 1, action_root);      // 初期パラ
    }else{
        set_mmd_param(mmdStatus.modelIndex, 1, action_root);      // 2回目のロードは選んだモデルをロードする
    }
    $("#mode_button").css("background", "orange").attr("mode", "command");
    $("#mode_button>div").text("コマンドモード");
    $("#youtube_control").css("display", "none");
    $("#youtube_frame").children().remove();
    draw_model_list();
    draw_music_list();
    draw_action_list();
    if (ready){
        destroy_three();
    }
    init_three();
}

// 一番最初のモーションを表示する(再生はしない)
function init_pause(){     
    var c_name = mmdStatus.modeName + String(mmdStatus.motionIndex);
    if (mesh.mixer.clipAction( c_name )){
        mesh.mixer.clipAction( c_name ).weight = 1; 
    }
    if (mesh.mixer.clipAction( c_name + 'Morph' )){
        mesh.mixer.clipAction( c_name + 'Morph' ).weight = 1;
    }
}

// モーションの再生
function play_motion(time){     
    var c_name = mmdStatus.modeName + String(mmdStatus.motionIndex);
    if (mesh.mixer.clipAction( c_name )){
        mesh.mixer.clipAction( c_name ).time = time;
        mesh.mixer.clipAction( c_name ).paused = false;
    }
    if (mesh.mixer.clipAction( c_name + 'Morph' )){
        mesh.mixer.clipAction( c_name + 'Morph' ).time = time;
        mesh.mixer.clipAction( c_name + 'Morph' ).paused = false;
    }
    mmdStatus.inAnimation = true;
}

// モーションの一時停止
function pause_motion(){
    var c_name = mmdStatus.modeName + String(mmdStatus.motionIndex);
    if (mesh.mixer.clipAction( c_name )){
        mesh.mixer.clipAction( c_name ).paused = true;
    }
    if (mesh.mixer.clipAction( c_name + 'Morph' )){
        mesh.mixer.clipAction( c_name + 'Morph' ).paused = true;
    }
    mmdStatus.inAnimation = false;
}

// リサイズイベント
window.addEventListener('resize', function(){
    onResize();
})
function onResize(){
    if( arToolkitSource !== null ){
        arToolkitSource.onResize();                 // WEBカメラのサイズをリサイズする (カスタムしたjsをオーバーライドした)
        arToolkitSource.copySizeTo(renderer.domElement);        // レンダラのサイズをWEBカメラのサイズに合わせる
    }
    if( arToolkitContext !== null ){
        if( arToolkitContext.arController !== null ){
            arToolkitSource.copySizeTo(arToolkitContext.arController.canvas);
        }	
    }
}


////////////////////////////////////////////////////////////////
//                  アクション制御
////////////////////////////////////////////////////////////////
var action_timer;
function play_action(actionIndex){
    if(mmdStatus.inAnimation == true){
        cancelAnimationFrame(action_timer);
    }
    $("#mode_button").css("background", "orange").attr("mode", "command");
    $(".arrow_box").css("display", "block");
    $(".arrow_box").text(motionParams[1].motions[actionIndex].title);
    $("#mode_button>div").text("コマンドモード");
    $("#youtube_frame").children().remove();
    $("#youtube_control").css("display", "none");
    var action_info = motionParams[1].motions[actionIndex]["action"].split("_");
    var action = action_info[0];
    var distance = parseFloat(action_info[1]);
    var duration = parseFloat(action_info[2]);
    // モデルを回転
    if (action == "right" || action == "left" || action == "back"){
        var temp_duration = 1.0;
        if (action == "right"){
            var A = -(Math.PI/2)/temp_duration;
        } else if (action == "left"){
            var A = (Math.PI/2)/temp_duration;
        } else {
            var A = Math.PI/temp_duration;
        }
        var aim = A*temp_duration;
        var action_date, action_time, init_date;
        var current_Y = mesh.rotation.y;
        mmdStatus.changeModeName = "action";
        mmdStatus.changeMotioinName = motionParams[1]["motions"][action_root].name;
        mmdStatus.changeMotionIndex = action_root;
        mmdStatus.changeMotion = true;
        var start_flag = false;
        action_timer = requestAnimationFrame(function animate(nowMsec){
            if (start_flag == false){
                if (mmdStatus.changeMotion == false){
                    start_flag = true;
                    init_date = new Date();
                    init_date = init_date.getTime();
                    play_motion(0);
                }
                action_timer = requestAnimationFrame( animate );
            }else{
                action_date = new Date();
                action_time = (action_date.getTime() - init_date) / 1000;
                mesh.rotation.y = A*action_time + current_Y;
                if (action_time >= temp_duration){
                    mesh.rotation.y = aim + current_Y;
                    cancelAnimationFrame(action_timer);
                    move_model(distance, duration);        // 終わったら進行方向に移動
                }else{
                    setTimeout( function() {
                        action_timer = requestAnimationFrame( animate );
                    },  1000 / 30 );        // FPS
                }
            }
        })
    }else{
        move_model(distance, duration);        // 終わったら進行方向に移動
    }
    // 移動
    function move_model(distance, duration){
        // モデルがどっちを向いているか判定
        var model_dirction, Y = radianNormalize(mesh.rotation.y);
        if (-0.7 < Y && Y < 0.7){
            model_dirction = "+z";      // 前
        }else if (0.8 < Y && Y < 2.3){
            model_dirction = "+x";      // 右
        }else if (-2.4 < Y && Y < -0.8){
            model_dirction = "-x";      // 左
        }else{
            model_dirction = "-z";      // 後ろ
        }
        mmdStatus.changeModeName = "action";
        mmdStatus.changeMotioinName = motionParams[1]["motions"][actionIndex].name;
        mmdStatus.changeMotionIndex = actionIndex;
        mmdStatus.changeMotion = true;
        var A = distance/duration;
        play_motion(actionIndex);
        var action_date, action_time, init_date;
        var current_X = mesh.position.x;
        var current_Z = mesh.position.z;
        var start_flag = false;
        if (duration == 0){
            return;
        }
        action_timer = requestAnimationFrame(function animate(nowMsec){
            if (start_flag == false){
                if (mmdStatus.changeMotion == false){
                    start_flag = true;
                    init_date = new Date();
                    init_date = init_date.getTime();
                    play_motion(0);
                }
                action_timer = requestAnimationFrame( animate );
            }else{
                action_date = new Date();
                action_time = (action_date.getTime() - init_date) / 1000;
                if (model_dirction == "-x"){
                    mesh.position.x = -A*action_time + current_X;
                }else if (model_dirction == "+x"){
                    mesh.position.x = A*action_time + current_X;
                }else if (model_dirction == "-z"){
                    mesh.position.z = -A*action_time + current_Z;
                }else if (model_dirction == "+z"){
                    mesh.position.z = A*action_time + current_Z;
                }
                if (action_time >= duration){
                    cancelAnimationFrame(action_timer);
                    pause_motion();
                    mmdStatus.changeModeName = "action";
                    mmdStatus.changeMotioinName = motionParams[1]["motions"][action_root].name;
                    mmdStatus.changeMotionIndex = action_root;
                    mmdStatus.changeMotion = true;
                }else{
                    setTimeout( function() {
                        action_timer = requestAnimationFrame( animate );
                    },  1000 / 30 );        // FPS
                }
            }
        })
    }
}


////////////////////////////////////////////////////////////////
//                  アクションリスト
////////////////////////////////////////////////////////////////
function draw_action_list(){
    $("#control_list").children().remove();
    $("#control_list").scrollTop(0);
    var vmd, name, action, title, dir;
    var motions = motionParams[1].motions;
    for (var i in motions){
        //console.log(motions[i]);
        vmd = motions[i].vmd;
        name = motions[i].name;
        action = motions[i].action;
        title = motions[i].title;
        dir = motions[i].dir;
        var $control = $("<div/>").addClass("control").attr("action", action).attr("dir", dir).attr("actionIndex", i).attr("actionName", name);
        var $control_info = $("<div/>").addClass("control_info");
        var $control_name_info = $("<div/>").addClass("control_name")
            .text("ボイスコマンド「" + title + "」")
            .appendTo($control_info);
        var $control_action_info = $("<div/>").addClass("control_action")
            .text("アクション: " + parse_action(action))
            .appendTo($control_info);
        var $control_motion_info = $("<div/>").addClass("control_motion")
            .text("モーションファイル: " + name)
            .appendTo($control_info);
        $control_info.appendTo($control);
        if (dir.startsWith("dir")){
            var $control_option = $("<div/>").addClass("control_option");
            var $control_option_btn = $("<div/>").addClass("control_option_button").addClass("close");
            var $arrow = $("<div/>").addClass("center_font").text("◀").appendTo($control_option_btn);
            $control_option_btn.appendTo($control_option);
            var $delete_control = $("<div/>").addClass("delete_control");
            var $dlt_msg = $("<div/>").addClass("center_font").text("削除").appendTo($delete_control);
            $delete_control.appendTo($control_option);
            $control_option.appendTo($control);
        }
        $control.appendTo($("#control_list"));
    }
}

// アクションのパーズ
function parse_action(action){
    var action_info = action.split("_");
    var action_name = action_info[0];
    var action_distance = action_info[1];
    var action_duration = action_info[2];
    var name, distance, duration;
    // name
    if (action_name == "right"){
        name = "右を向き";
    }else if (action_name == "left"){
        name = "左を向き";
    }else if (action_name == "back"){
        name = "後ろを向き";
    }else if (action_name == "front"){
        name = "そのまま";
    }
    // distance
    if (action_distance == "0"){
        distance = "その場で";
    }else{
        distance = action_distance + "m進み";
    }
    // duration
    if (action_duration == "0"){
        duration = "何もしない";
    }else{
        duration = action_duration + "秒間の間、以下のモーションを行う。";
    }
    return name + "、" + distance + "、" + duration;
}

// アクションの選択
$(document).on("click", ".control_info", function(){
    $("#menu_button").css("display", "block");
    $("#mic").css("display", "block");
    $("#mode_button").css("display", "flex");
    $("#menu_window").css("display", "none");
    $("#youtube_panel").css("display", "none");
    $("#music_motion_input_panel").css("display", "none");
    $("#model_input_panel").css("display", "none");
    close_music_option();
    close_model_option();
    close_control_option();
    var actionIndex = parseInt($(this).parent().attr("actionIndex"));
    play_action(actionIndex);
});

// アクションの削除
$(document).on("click", ".delete_control", function(){
    var dir_name = decodeURI($(this).parent().parent().attr("dir"));
    fs.root.getDirectory('actions', {create: true}, function(dirEntry){                              // create ./musics
        var dirReader = dirEntry.createReader();
        dirReader.readEntries (function(results) {
            for (var i in results){
                if (results[i].name == dir_name){
                    results[i].removeRecursively(function() {
                        console.log('remove ' + dir_name);
                        load_mmd_files(false);           // 書き込みが終了したら、もう一度パラメータを変える
                    });
                }
            }
        });
    },err);
});


////////////////////////////////////////////////////////////////
//                  アクションの追加
////////////////////////////////////////////////////////////////
$(document).on("click", "#add_control", function(){
    close_control_option();
    $("#control_input_panel").fadeIn();
});
$(document).on("click", "#close_control_input", function(){
    $("#control_input_panel").fadeOut();
});

$(":file#control_vmd_load").on("change", function() {         
    var files = this.files;     // ファイルリスト
    if(!files) return;
    var file_type = files[0].name.split(".").slice(-1)[0].toLowerCase();
    if(file_type != "vmd"){
        alert("VMDファイルを選択してください");
        return;
    }
    var action_name = $("#command_input").val();
    if (command2idx[action_name] != undefined){
        alert("そのコマンド名は既に使われています");
        return;
    }
    if (action_name == ""){
        alert("コマンド名を入力してください");
        return;
    }
    var action_direction = $("#input_direction").val();
    var action_distance = String($("#input_distance").val());
    var action_duration = String($("#input_duration").val());
    fs.root.getDirectory('actions', {create: true}, function(dirEntry){
        var w_dir_name = files[0].name.split(".").slice(0, -1).join("_").split(" ").join("") + "_" + action_name;
        dirEntry.getDirectory("dir_"+w_dir_name, {create: true}, function(action_dirEntry){ 
            action_dirEntry.getFile('action.json', {create: true}, function(fileEntry) {
                console.log(action_name, action_direction, action_distance, action_duration);
                var action_json = JSON.stringify({'dir_name': "dir_"+w_dir_name, 'name': action_name, 'action':action_direction+"_"+action_distance+"_"+action_duration});
                var action_blob = new Blob([action_json], {type: "application/json"});
                fileEntry.createWriter(function(writer) {
                    writer.onwriteend = function() {
                        console.log("write file system: action.json");
                    };
                    writer.write(action_blob);
                }, err);
            }, err);
            action_dirEntry.getFile(files[0].name, {create: true}, function(fileEntry) {
                fileEntry.createWriter(function(writer) {
                    var fr = new FileReader;        // File API呼び出し 新しいblobを作る
                    fr.onloadend = function() {
                        var blob = new Blob([fr.result]);
                        writer.write(blob);
                    };
                    fr.onerror = err;
                    fr.readAsArrayBuffer(files[0]);     // ここでArrayBufferとしてfrを読み込んでいる
                    writer.onwriteend = function() {
                        console.log("write file system: " + files[0].name);
                        load_mmd_files(false);           // 書き込みが終了したら、もう一度パラメータを変える
                        $("#control_input_panel").fadeOut();
                    };
                }, err);
            }, err);
        }, err);
    }, err);
});


////////////////////////////////////////////////////////////////
//                  YouTube動画関連
////////////////////////////////////////////////////////////////
$("#youtube_form").submit(function( event ) {
    search_youtube();
    event.preventDefault();
});
$(document).on("click", "#search_button", function(){
    search_youtube();
});

// youtube動画の検索
function search_youtube(){
    var query = $("#youtube_input").val();
    $("#youtube_input").trigger('blur');
    if (query != ""){
        $("#search_results").children().remove();
        $("#youtube_message").text("けんさくちゅう...").css("display", "block");
        var KEY = 'AIzaSyBkaPgfMvj9oJ1HgrOFu1SLFiNWbNXfWEU';
        $.ajax({
            type     : "get",
            dataType : "jsonp",
            url      : "https://www.googleapis.com/youtube/v3/search?type=video&orderby=viewCount&part=snippet&maxResults=50&q=" + query + "&key=" + KEY
        }).done(function(json) {
            draw_youtube(json.items);
        });
    }
}

// youtube検索結果の表示
function draw_youtube(youtube_data){
    $("#youtube_message").css("display", "none").text("けんさくけっか");
    $("#search_results").scrollTop(0);
    for (var i in youtube_data){
        //console.log(youtube_data[i]);
        var $youtube_movie = $("<div/>").addClass("youtube_movie").attr("video_id", youtube_data[i].id.videoId);
        var $youtube_thumb = $("<div/>").addClass("youtube_thumb");
        var $youtube_number = $("<div/>").addClass("youtube_number");
        var $num = $("<div/>").addClass("center_font").text(String(parseInt(i)+1)).appendTo($youtube_number);
        $youtube_number.appendTo($youtube_thumb);
        var $youtube_img = $("<img/>")
            .attr("src", youtube_data[i].snippet.thumbnails.default.url)
            .attr("height", "100%")
            .appendTo($youtube_thumb);
        $youtube_thumb.appendTo($youtube_movie);
        var $youtube_info = $("<div/>").addClass("youtube_info");
        var $youtube_title_info = $("<div/>").addClass("youtube_title_info")
            .text("動画名: " + youtube_data[i].snippet.title)
            .appendTo($youtube_info);
        var publish_day = new Date(youtube_data[i].snippet.publishedAt);
        var $youtube_play_info = $("<div/>").addClass("youtube_play_info")
            .text("投稿者: " + youtube_data[i].snippet.channelTitle + "　　投稿日: " + formatDate(publish_day, 'YYYY年 MM月DD日 hh時mm分'))
            .appendTo($youtube_info);
        $youtube_info.appendTo($youtube_movie);
        $youtube_movie.appendTo($("#search_results"));
    }
}


////////////////////////////////////////////////////////////////
//                  音楽モーションの追加
////////////////////////////////////////////////////////////////
var temp_video_id, temp_img, temp_title;
$(document).on("click", ".youtube_movie", function(){
    temp_video_id = $(this).attr("video_id");
    temp_img = $(this).find("img").attr("src");
    temp_title = $(this).find(".youtube_title_info").text().replace("動画名: ", "");
    $("#youtube_panel").fadeOut();
    $("#music_motion_input_panel").fadeIn();
});

// モーション選択画面を閉じる
$(document).on("click", "#close_music_motion_input", function(){
    $("#music_motion_input_panel").fadeOut();
    $("#youtube_panel").fadeIn();
});

// 楽曲とモーションの情報をファイルシステムに保存
$(":file#music_vmd_load").on("change", function() {         
    var files = this.files;     // ファイルリスト
    if(!files) return;
    var file_type = files[0].name.split(".").slice(-1)[0].toLowerCase();
    if(file_type != "vmd"){
        alert("VMDファイルを選択してください")
            return;
    }
    $("#youtube_frame").children().remove();
    $("#youtube_control").css("display", "none");
    $("#menu_window").css("display", "none");
    fs.root.getDirectory('musics', {create: true}, function(dirEntry){
        var w_dir_name = files[0].name.split(".").slice(0, -1).join("_").split(" ").join("") + "_" + temp_video_id;
        dirEntry.getDirectory("dir_"+w_dir_name, {create: true}, function(youtube_dirEntry){ 
            youtube_dirEntry.getFile('video.json', {create: true}, function(fileEntry) {
                var default_video_json = JSON.stringify({'img': temp_img, 
                    'video_id': temp_video_id, 'title':temp_title});
                var default_video_blob = new Blob([default_video_json], {type: "application/json"});
                fileEntry.createWriter(function(writer) {
                    writer.onwriteend = function() {
                        console.log("write file system: video.json");
                    };
                    writer.write(default_video_blob);
                }, err);
            }, err);
            youtube_dirEntry.getFile(files[0].name, {create: true}, function(fileEntry) {
                fileEntry.createWriter(function(writer) {
                    var fr = new FileReader;        // File API呼び出し 新しいblobを作る
                    fr.onloadend = function() {
                        var blob = new Blob([fr.result]);
                        writer.write(blob);
                    };
                    fr.onerror = err;
                    fr.readAsArrayBuffer(files[0]);     // ここでArrayBufferとしてfrを読み込んでいる
                    writer.onwriteend = function() {
                        console.log("write file system: " + files[0].name);
                        load_mmd_files(false);           // 書き込みが終了したら、もう一度パラメータを変える
                        $("#music_motion_input_panel").fadeOut();
                    };
                }, err);
            }, err);
        }, err);
    }, err);
});


////////////////////////////////////////////////////////////////
//                  ミュージックリスト
////////////////////////////////////////////////////////////////
function draw_music_list(){
    $("#music_list").children().remove();
    $("#music_list").scrollTop(0);
    var vmd, name, video_id, title, img, dir;
    var motions = motionParams[0].motions;
    for (var i in motions){
        //console.log(motions[i]);
        vmd = motions[i].vmd;
        name = motions[i].name;
        video_id = motions[i].video_id;
        title = motions[i].title;
        img = motions[i].img;
        dir = motions[i].dir;

        var $music = $("<div/>").addClass("music").attr("video_id", video_id).attr("dir", dir).attr("motionIndex", i).attr("motionName", name);
        var $music_thumb = $("<div/>").addClass("music_thumb");
        var $music_number = $("<div/>").addClass("music_number");
        var $num = $("<div/>").addClass("center_font").text(String(parseInt(i)+1)).appendTo($music_number);
        $music_number.appendTo($music_thumb);
        var $music_img = $("<img/>")
            .attr("src", img)
            .attr("height", "100%")
            .appendTo($music_thumb);
        $music_thumb.appendTo($music);
        var $music_info = $("<div/>").addClass("music_info");
        var $music_title_info = $("<div/>").addClass("title_info")
            .text("動画名: " + title)
            .appendTo($music_info);
        var $music_play_info = $("<div/>").addClass("motion_info")
            .text("モーション: " + name)
            .appendTo($music_info);
        $music_info.appendTo($music);
        if (dir.startsWith("dir")){
            var $music_option = $("<div/>").addClass("music_option");
            var $music_option_btn = $("<div/>").addClass("music_option_button").addClass("close");
            var $arrow = $("<div/>").addClass("center_font").text("◀").appendTo($music_option_btn);
            $music_option_btn.appendTo($music_option);
            var $delete_music = $("<div/>").addClass("delete_music");
            var $dlt_msg = $("<div/>").addClass("center_font").text("削除").appendTo($delete_music);
            $delete_music.appendTo($music_option);
            $music_option.appendTo($music);
        }
        $music.appendTo($("#music_list"));
    }
}

// 楽曲の削除
$(document).on("click", ".delete_music", function(){
    var dir_name = decodeURI($(this).parent().parent().attr("dir"));
    fs.root.getDirectory('musics', {create: true}, function(dirEntry){                              // create ./musics
        var dirReader = dirEntry.createReader();
        dirReader.readEntries (function(results) {
            for (var i in results){
                if (results[i].name == dir_name){
                    if (results[i].name != "_default_wave_file"){
                        results[i].removeRecursively(function() {
                            console.log('remove ' + dir_name);
                            $("#youtube_frame").children().remove();
                            $("#youtube_control").css("display", "none");
                            $("#menu_window").css("display", "none");
                            load_mmd_files(false);           // 書き込みが終了したら、もう一度パラメータを変える
                        });
                    }
                }
            }
        });
    },err);
});

// 楽曲の選択
var yt_player;
$(document).on("click", ".music_info,.music_thumb", function(){
    $("#menu_button").css("display", "block");
    $("#mode_button").css("display", "flex");
    $("#mic").css("display", "none");
    $(".arrow_box").css("display", "none");
    close_music_option();
    $("#menu_window").fadeOut();
    var video_id = $(this).parent().attr("video_id");
    $("#youtube_frame").children().remove();
    $("#youtube_control").css("display", "none");
    $("<div/>").attr("id", "yt_player").appendTo($("#youtube_frame"));
    var motions = motionParams[0].motions;          // 選択したidのモーションに設定する
    var motionIndex = parseInt($(this).parent().attr("motionIndex"));
    mmdStatus.changeModeName = "music";
    mmdStatus.changeMotioinName = motions[motionIndex].name;
    mmdStatus.changeMotionIndex = motionIndex;
    mmdStatus.changeMotion = true;
    yt_player = new YT.Player('yt_player', {
        height: '90',
        width: '160',
        videoId: video_id,
        playerVars: {
            autoplay: 0, // 自動再生する・しない
            controls: 1, // コントロールを表示する・しない
            showinfo: 0, // 動画の情報テキストを表示する・しない
            theme: "dark" // テーマの選択（dark|light）
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
});

// 曲送り
$(document).on("click", "#next_yt", function(){
    if (mmdStatus.modeName != "music"){
        return;
    }
    var target_motionIndex;
    var total_songs = motionParams[0].motions.length;
    if (mmdStatus.motionIndex == total_songs-1){     // 最後の時は一番最初の曲にする
        target_motionIndex = 0;
    }else{
        target_motionIndex = mmdStatus.motionIndex+1;
    }
    $("#youtube_frame").children().remove();
    $("#youtube_control").css("display", "none");
    $("<div/>").attr("id", "yt_player").appendTo($("#youtube_frame"));
    var motions = motionParams[0].motions;          // 選択したidのモーションに設定する
    var motionIndex = target_motionIndex;
    var video_id = motions[motionIndex].video_id;
    mmdStatus.changeModeName = "music";
    mmdStatus.changeMotioinName = motions[motionIndex].name;
    mmdStatus.changeMotionIndex = motionIndex;
    mmdStatus.changeMotion = true;
    yt_player = new YT.Player('yt_player', {
        height: '90',
        width: '160',
        videoId: video_id,
        playerVars: {
            autoplay: 0, // 自動再生する・しない
            controls: 1, // コントロールを表示する・しない
            showinfo: 0, // 動画の情報テキストを表示する・しない
            theme: "dark" // テーマの選択（dark|light）
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
});

// 曲戻し
$(document).on("click", "#prev_yt", function(){
    if (mmdStatus.modeName != "music"){
        return;
    }
    var target_motionIndex; 
    var total_songs = motionParams[0].motions.length;
    if (mmdStatus.motionIndex == 0){     // 先頭の時は一番最後の曲にする
        target_motionIndex = total_songs-1;
    }else{
        target_motionIndex = mmdStatus.motionIndex-1;
    }
    $("#youtube_frame").children().remove();
    $("#youtube_control").css("display", "none");
    $("<div/>").attr("id", "yt_player").appendTo($("#youtube_frame"));
    var motions = motionParams[0].motions;          // 選択したidのモーションに設定する
    var motionIndex = target_motionIndex;
    var video_id = motions[motionIndex].video_id;
    mmdStatus.changeModeName = "music";
    mmdStatus.changeMotioinName = motions[motionIndex].name;
    mmdStatus.changeMotionIndex = motionIndex;
    mmdStatus.changeMotion = true;
    yt_player = new YT.Player('yt_player', {
        height: '90',
        width: '160',
        videoId: video_id,
        playerVars: {
            autoplay: 0, // 自動再生する・しない
            controls: 1, // コントロールを表示する・しない
            showinfo: 0, // 動画の情報テキストを表示する・しない
            theme: "dark" // テーマの選択（dark|light）
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
});

// プレーヤーが準備できたときに呼び出す
function onPlayerReady(event){
    console.log("load YouTube");
    $("#mic").css("display", "none");
    $(".arrow_box").css("display", "none");
    $("#mode_button").css("background", "cyan").attr("mode", "music");
    $("#mode_button>div").text("ミュージックモード");
    $("#youtube_control").css("display", "block");
}

// プレーヤーのステータス
function onPlayerStateChange(event){
    if(event.data==1) {     // playing
        var current_time = yt_player.getCurrentTime();
        if (ready){
            play_motion(current_time);
        }
    }else {                 // not playing
        if (ready){
            pause_motion();
        }
    }
}


////////////////////////////////////////////////////////////////
//                  モデルの追加
////////////////////////////////////////////////////////////////
$(document).on("click", "#add_model", function(){
    close_model_option();
    $("#model_desc").text("MMDのモデルファイル等を圧縮したzipファイルを選択してください。（本サイトではオンラインへのモデルファイルのアップロードは行いません。）注意！モデルによってはテクスチャの乱れや表示が正しくされない場合があります。モデル制作者様の意図に反する用途はご控えください。");
    $("#model_input_panel").fadeIn();
});

$(document).on("click", "#close_model_input", function(){
    $("#model_input_panel").fadeOut();
});

// モデルをファイルシステムに保存
$(":file#model_pmd_load").on("change", function() { 
    $("#now_load_pmd").css("display", "block");
    $("#model_pmd_input").css("display", "none");

    var files = this.files;     // ファイルリスト
    if(!files){
        $("#now_load_pmd").css("display", "none");
        $("#model_pmd_input").css("display", "block");
        return;
    }
    var file_type = files[0].name.split(".").slice(-1)[0].toLowerCase();
    if(file_type != "zip"){
        alert("zipファイルを選択してください");
        $("#now_load_pmd").css("display", "none");
        $("#model_pmd_input").css("display", "block");
        return;
    }
    var model_contain = false;
    $("#youtube_frame").children().remove();
    $("#youtube_control").css("display", "none");
    var file = files[0];
    zip_model.getEntries(file, function(entries) {            // 解凍されたファイル
        var total_entry = entries.length;
        var entry_count = 0;
        entries.forEach(function(entry) {
            if (!(entry.filename.startsWith('__MACOSX'))){      // MAC OSで圧縮したzipは変なのが有るので除外
                var sub_dir_info = ["model"].concat(("dir_" + entry.filename).split(" ").join("_").split("/"));
                var sub_dir_path = sub_dir_info.slice(0,sub_dir_info.length-1).join("/") + "/";
                sub_dir_path = sub_dir_path.toLowerCase();
                var file_name = concatDakuten(sub_dir_info[sub_dir_info.length-1]).toLowerCase();
                if (file_name != ''){
                    var file_type = file_name.split(".").slice(-1)[0];
                    if (file_type == "pmx" || file_type == "pmd"){
                        model_contain = true;
                    }
                    fs.root.getDirectory(sub_dir_path, {create: true}, function(dirEntry) {
                        dirEntry.getFile(file_name, { create: true }, function(fileEntry) {
                            fileEntry.createWriter(function(writer) {
                                var zip_writer = new zip.BlobWriter(entry);
                                entry.getData(zip_writer, function(blob) {
                                    writer.onwriteend = function() {
                                        console.log("write file system (" + String(entry_count+1) + "/" + String(total_entry) + "): " + file_name);
                                        $("#model_desc").text("Load MMD (" + String(entry_count+1) + "/" + String(total_entry) + "): " + file_name);
                                        entry_count += 1;
                                        if (entry_count == total_entry){
                                            if (model_contain == false){
                                                remove_model(sub_dir_path);
                                                alert("pmd/pmxファイルが含まれたzipファイルを選択してください。");
                                            }else{
                                                update_model_info();
                                            }
                                        }
                                    };
                                    writer.write(blob);                         // 書き込む
                                }, onprogress);
                            }, err);
                        }, err);
                    }, err);
                }else{
                    entry_count += 1;
                    if (entry_count == total_entry){
                        if (model_contain == false){
                            remove_model(sub_dir_path);
                            console.log(sub_dir_path);
                            alert("pmd/pmxファイルが含まれたzipファイルを選択してください。");
                        }else{
                            update_model_info();
                        }
                    }
                }
            }else{
                entry_count += 1;
                if (entry_count == total_entry){
                    if (model_contain == false){
                        remove_model(sub_dir_path);
                        alert("pmd/pmxファイルが含まれたzipファイルを選択してください。");
                    }else{
                        update_model_info();
                    }
                }
            }
        });
    });
});


////////////////////////////////////////////////////////////////
//                  モデルリスト
////////////////////////////////////////////////////////////////
function draw_model_list(){
    $("#model_list").children().remove();
    $("#model_list").scrollTop(0);
    var pmd, name, dir;
    for (var i in modelParams){
        pmd = modelParams[i].file;
        name = modelParams[i].name;
        dir = modelParams[i].dir;
        var $model = $("<div/>").addClass("model").attr("dir", dir);
        var $model_info = $("<div/>").addClass("model_info")
            .attr("modelIndex", i)
            .attr("modelName", name)
            .text(name).appendTo($model);
        if (dir.startsWith("dir")){
            var $model_option = $("<div/>").addClass("model_option");
            var $model_option_btn = $("<div/>").addClass("model_option_button").addClass("close");
            var $arrow = $("<div/>").addClass("center_font").text("◀").appendTo($model_option_btn);
            $model_option_btn.appendTo($model_option);
            var $delete_model = $("<div/>").addClass("delete_model");
            var $dlt_msg = $("<div/>").addClass("center_font").text("削除").appendTo($delete_model);
            $delete_model.appendTo($model_option);
            $model_option.appendTo($model);
        }
        $model.appendTo($("#model_list"));
    }
}

// モデルの選択
$(document).on("click", ".model_info", function(){
    $("#menu_button").css("display", "block");
    $("#mode_button").css("display", "flex");
    $("#mic").css("display", "block");
    $("#menu_window").css("display", "none");
    var modelIndex = parseInt($(this).attr("modelIndex"));
    mmdStatus.modelIndex = modelIndex;
    mmdStatus.modelName = modelParams[modelIndex].name;
    load_mmd_files(false);
});


// モデルの削除
$(document).on("click", ".delete_model", function(){
    var dir_name = decodeURI($(this).parent().parent().attr("dir"));
    fs.root.getDirectory('model', {create: true}, function(dirEntry){                              // create ./musics
        var dirReader = dirEntry.createReader();
        dirReader.readEntries (function(results) {
            for (var i in results){
                if (results[i].name == dir_name){
                    if (results[i].name != "_default_miku"){
                        results[i].removeRecursively(function() {
                            console.log('remove ' + dir_name);
                            $("#youtube_frame").children().remove();
                            $("#youtube_control").css("display", "none");
                            update_model_info();
                        });
                    }
                }
            }
        });
    },err);
});

// 特定のフォルダの削除
function remove_model(path){
    fs.root.getDirectory(path, {create: true}, function(dirEntry){  
        dirEntry.removeRecursively(function() {
            console.log('remove ' + dirEntry.name);
        });
    },err);
}

////////////////////////////////////////////////////////////////
//                  ファイルシステムAPI
////////////////////////////////////////////////////////////////
var fs, err = function(e) {
    console.log('Error: ' + e.code);
    alert("読み込みエラー！")
    $("#load_console").text("file system error: reload this page or reset all setting");
};

// データを全削除 for Debug
var remove_flag = false;
function remove_file_system(){
    webkitRequestFileSystem(window.TEMPORARY, 5*1024*1024*1024, function(_fs) {
        fs = _fs;
        var dirReader = fs.root.createReader();
        dirReader.readEntries (function(results) {
            var total_object = results.length;
            var count = 0;
            if (results.length > 0){
                for (var i in results){
                    console.log("hoge");
                    if(results[i]["isFile"]){
                        results[i].remove(function() {
                            count += 1;
                            if (count >= total_object){
                                remove_flag = true;
                                console.log('remove all files');
                                $("#load_console").text("initialization");
                            }
                        },  err);
                    }else if(results[i]["isDirectory"]){
                        results[i].removeRecursively(function() {
                            count += 1;
                            if (count >= total_object){
                                remove_flag = true;
                                console.log('remove all files');
                                $("#load_console").text("initialization");
                            }
                        }, err);
                    }
                }
            }else{
                remove_flag = true;
                console.log('remove all files');
                $("#load_console").text("initialization");
            }
        });
    },err);
}

// ZIPの解凍
var zip_model = (function() {
    return {
        getEntries : function(file, onend) {                                            // ZIPの解凍
            zip.createReader(new zip.BlobReader(file), function(zipReader) {
                zipReader.getEntries(onend);
            }, onerror);
        }
    };
})();

// ファイルシステムの初期化とデフォルトモデル・モーションの読み込み
var init_load_model_flag = false;
var init_load_music_flag = false;
var init_load_motion_flag = false;
var init_load_action_flag = false;
var init_load_action_info_flag = false;
var file_system_root_path = '';
function init_file_system(){
    webkitRequestFileSystem(window.TEMPORARY, 5*1024*1024*1024, function(_fs) {
        fs = _fs;
        // create default model folder
        fs.root.getDirectory('model', {create: true}, function(dirEntry){                               // create ./model
            file_system_root_path = dirEntry.toURL().split("/");
            file_system_root_path = file_system_root_path.slice(0,file_system_root_path.length-1).join("/") + "/";
            var init_load = true;
            var dirReader = dirEntry.createReader();
            dirReader.readEntries (function(results) {
                for (var i in results){
                    if(results[i].name.startsWith("_default_miku")){
                        init_load = false;
                    }
                }
                if (init_load == true){
                    var loaded_count = 0;
                    var default_model_zip_blob = null;
                    var xhr = new XMLHttpRequest(); 
                    xhr.open("GET", "default/default_miku.zip"); 
                    xhr.responseType = "blob";
                    xhr.onload = function() {
                        default_model_zip_blob = xhr.response;
                        var file = new File([default_model_zip_blob], "miku.zip");
                        zip_model.getEntries(file, function(entries) {            // 解凍されたファイル
                            var total_entry = entries.length;
                            entries.forEach(function(entry) {
                                if (!(entry.filename.startsWith('__MACOSX'))){      // MAC OSで圧縮したzipは変なのが有るので除外
                                    // STEP1: まずはフォルダ構造がない場合、そのフォルダ構造を作る
                                    var sub_dir_info = ["model"].concat(entry.filename.split("/"));
                                    var sub_dir_path = sub_dir_info.slice(0,sub_dir_info.length-1).join("/") + "/";
                                    sub_dir_path = sub_dir_path.toLowerCase();
                                    var file_name = concatDakuten(sub_dir_info[sub_dir_info.length-1]).toLowerCase();;
                                    if (file_name != ''){
                                        fs.root.getDirectory(sub_dir_path, {create: true}, function(dirEntry) {
                                            dirEntry.getFile(file_name, { create: true }, function(fileEntry) {
                                                fileEntry.createWriter(function(writer) {
                                                    var zip_writer = new zip.BlobWriter(entry);
                                                    entry.getData(zip_writer, function(blob) {
                                                        writer.onwriteend = function() {
                                                            loaded_count += 1;
                                                            $("#load_console").text("write model file (" + String(loaded_count) + "/" + String(total_entry) + "): " + file_name);
                                                            console.log("write file system (" + String(loaded_count) + "/" + String(total_entry) + "): " + file_name);
                                                            if (loaded_count == total_entry){
                                                                init_load_model_flag = true;
                                                            }
                                                        };
                                                        writer.write(blob);                         // 書き込む
                                                    }, onprogress);
                                                }, err);
                                            }, err);
                                        }, err);
                                    }else{
                                        loaded_count += 1;
                                        if (loaded_count == total_entry){
                                            init_load_model_flag = true;
                                        }
                                    }
                                }else{
                                    loaded_count += 1;
                                    if (loaded_count == total_entry){
                                        init_load_model_flag = true;
                                    }
                                }
                            });
                        });
                    };
                    xhr.send();
                }else{
                    console.log("already loaded: default model.");
                    $("#load_console").text("already loaded: default model");
                    init_load_model_flag = true;
                }
            }, err);
        }, err);
        // create default music folder
        fs.root.getDirectory('musics', {create: true}, function(dirEntry){                              // create ./musics
            dirEntry.getDirectory('_default_wave_file', {create: true}, function(youtube_dirEntry){     // create ./musics/default_wave_file
                var dirReader = youtube_dirEntry.createReader();
                dirReader.readEntries (function(results) {
                    if (results.length == 0){                       // 本当に最初だけ読み込む 2回目以降はロードしない
                        youtube_dirEntry.getFile('video.json', {create: true}, function(fileEntry) {              // create ./musics/default_wave_file/video.json
                            var default_video_json = JSON.stringify({'img': 'https://i.ytimg.com/vi/RAeSKoyUSW8/default.jpg', 
                                'video_id': 'RAeSKoyUSW8', 'title':'【MMD】 Wavefile Full 【モーション完成】'});
                            var default_video_blob = new Blob([default_video_json], {type: "application/json"});
                            fileEntry.createWriter(function(writer) {
                                writer.onwriteend = function() {
                                    init_load_music_flag = true;
                                    console.log("write file system: music");
                                    $("#load_console").text("write music json");
                                };
                                writer.write(default_video_blob);
                            }, err);
                        }, err);
                        youtube_dirEntry.getFile('wavefile.vmd', {create: true}, function(fileEntry) {         // create ./musics/default_wave_file/wavefile.vmd
                            var default_vmd_blob = null;
                            var xhr = new XMLHttpRequest(); 
                            xhr.open("GET", "./default/WAVEFILE_fullver/wavefile_full_miku_v2.vmd"); 
                            xhr.responseType = "blob";
                            xhr.onload = function() {
                                default_vmd_blob = xhr.response;
                                fileEntry.createWriter(function(writer) {
                                    writer.onwriteend = function() {
                                        init_load_motion_flag = true;
                                        console.log("write file system: motion");
                                        $("#load_console").text("write music motion");
                                    };
                                    writer.write(default_vmd_blob);
                                }, err);
                            };
                            xhr.send();
                        }, err);
                    }else{
                        console.log("already loaded: default music.");
                        $("#load_console").text("already loaded: default music");
                        init_load_music_flag = true;
                        init_load_motion_flag = true;
                    }
                });
            },  err);
        },  err);
        // create default action folder 
        var default_actions = [
        {'vmd':'default/action/default_walking.vmd', 'dir_name':'_default_front_walking', 'name':'前に進んで', 'action': 'front_1_1'}, 
        {'vmd':'default/action/default_walking.vmd', 'dir_name':'_default_back_walking', 'name':'後ろに進んで', 'action': 'back_1_1'}, 
        {'vmd':'default/action/default_walking.vmd', 'dir_name':'_default_right_walking', 'name':'右に進んで', 'action': 'right_1_1'}, 
        {'vmd':'default/action/default_walking.vmd', 'dir_name':'_default_left_walking', 'name':'左に進んで', 'action': 'left_1_1'}, 
        {'vmd':'default/action/default_walking.vmd', 'dir_name':'_default_right', 'name':'右を向いて', 'action': 'right_0_0'}, 
        {'vmd':'default/action/default_walking.vmd', 'dir_name':'_default_left', 'name':'左を向いて', 'action': 'left_0_0'}, 
        {'vmd':'default/action/default_walking.vmd', 'dir_name':'_default_back', 'name':'振り返って', 'action': 'back_0_0'}
        ];
        fs.root.getDirectory('actions', {create: true}, function(dirEntry){                              // create ./actions
            var dirReader = dirEntry.createReader();
            dirReader.readEntries (function(results) {
                if (results.length == 0){                       // 本当に最初だけ読み込む 2回目以降はロードしない
                    var json_i = 0;
                    var vmd_i = 0;
                    for (let da in default_actions){

                        dirEntry.getDirectory(default_actions[da]['dir_name'], {create: true}, function(action_dirEntry){     // create ./actions/default_action
                            action_dirEntry.getFile('action.json', {create: true}, function(fileEntry) {              // create ./musics/default_action/action.json
                                var default_action_json = JSON.stringify(default_actions[da]);
                                var default_action_blob = new Blob([default_action_json], {type: "application/json"});
                                fileEntry.createWriter(function(writer) {
                                    writer.onwriteend = function() {
                                        console.log("write file system: action json");
                                        $("#load_console").text("write action json");
                                        json_i += 1;
                                        if (json_i == default_actions.length){
                                            init_load_action_info_flag = true;
                                        }
                                    };
                                    writer.write(default_action_blob);
                                }, err);
                            }, err);
                            action_dirEntry.getFile(default_actions[da]["vmd"].split("/").slice(-1)[0], {create: true}, function(fileEntry) {         // create ./musics/default_wave_file/wavefile.vmd
                                var default_vmd_blob = null;
                                var xhr = new XMLHttpRequest(); 
                                xhr.open("GET", default_actions[da]["vmd"]); 
                                xhr.responseType = "blob";
                                xhr.onload = function() {
                                    default_vmd_blob = xhr.response;
                                    fileEntry.createWriter(function(writer) {
                                        writer.onwriteend = function() {
                                            console.log("write file system: action motion");
                                            $("#load_console").text("write action motion");
                                            vmd_i += 1;
                                            if (vmd_i == default_actions.length){
                                                init_load_action_flag = true;
                                            }
                                        };
                                        writer.write(default_vmd_blob);
                                    }, err);
                                };
                                xhr.send();
                            }, err);
                        }, err);
                    }
                }else{
                    console.log("already loaded: default action.");
                    $("#load_console").text("already loaded: default action");
                    init_load_action_flag = true;
                    init_load_action_info_flag = true;
                }
            });
        }, err);
    }, err);
}

// ファイルシステム上の全てのMMDのファイル情報(モデルとモーション)を変数に保存
var info_load_model_flag = false;
var info_load_music_flag = false;
var info_load_action_flag = false;
function load_mmd_files(is_init){
    info_load_model_flag = false;
    info_load_music_flag = false;
    info_load_action_flag = false;
    modelParams = [];
    motionParams = [{name: 'music', motions: []}, {name: 'action', motions: []}];
    command2idx = {}
    webkitRequestFileSystem(window.TEMPORARY, 5*1024*1024*1024, function(_fs) {
        fs = _fs;
        fs.root.getDirectory('model', {create: true}, function(dirEntry){                       // load model
            var dirReader = dirEntry.createReader();
            dirReader.readEntries (function(results) {
                var total_model = results.length;
                var load_model_count = 0;
                for (var i in results){
                    if(results[i]["isDirectory"]){
                        var modelReader = results[i].createReader();
                        modelReader.readEntries (function(model_results) {
                            for (var j in model_results){
                                if(model_results[j]["isFile"]){
                                    var file_name = model_results[j].name;
                                    var file_type = file_name.split(".").slice(-1)[0];
                                    if(file_type == 'pmd' || file_type == 'pmx'){
                                        var model_dir = model_results[j].toURL().split("/").slice(-2)[0]
                                            modelParams.push({name:file_name, 
                                                file:model_results[j].toURL(), 
                                                dir:model_dir});
                                        load_model_count += 1;
                                        if (load_model_count >= total_model){
                                            info_load_model_flag = true;
                                            if (info_load_model_flag == true && info_load_music_flag == true && info_load_action_flag == true){
                                                draw_mmd(is_init);
                                            }
                                        }
                                    }
                                }
                            }
                        });
                    }
                }
            });
        });
        fs.root.getDirectory('musics', {create: true}, function(dirEntry){                       // load music
            var dirReader = dirEntry.createReader();
            dirReader.readEntries (function(results) {
                var total_music = 2*results.length;
                var load_count = 0;
                var k = 0;
                var l = 0;
                for (var i in results){
                    if(results[i]["isDirectory"]){
                        var musicReader = results[i].createReader();
                        musicReader.readEntries (function(music_results) {
                            var motions = {};
                            motionParams[0].motions.push({});
                            for (var j in music_results){
                                if(music_results[j]["isFile"]){
                                    var file_name = music_results[j].name;
                                    var file_type = file_name.split(".").slice(-1)[0];
                                    if(file_type == 'json' ){
                                        $.getJSON( music_results[j].toURL(), function( json ) {
                                            motionParams[0].motions[k]["video_id"] = json["video_id"];
                                            motionParams[0].motions[k]["title"] = json["title"];
                                            motionParams[0].motions[k]["img"] = json["img"];
                                            k += 1;
                                            load_count += 1;
                                            if (load_count == total_music){
                                                info_load_music_flag = true;
                                                if (info_load_model_flag == true && info_load_music_flag == true && info_load_action_flag == true){
                                                    draw_mmd(is_init);
                                                }
                                            }
                                        });
                                    }
                                    if(file_type == 'vmd' ){
                                        motionParams[0].motions[l]["vmd"] = music_results[j].toURL();
                                        motionParams[0].motions[l]["name"] = file_name;
                                        motionParams[0].motions[l]["dir"] = music_results[j].toURL().split("/").slice(-2)[0];
                                        l += 1;
                                        load_count += 1;
                                        if (load_count == total_music){
                                            info_load_music_flag = true;
                                            if (info_load_model_flag == true && info_load_music_flag == true && info_load_action_flag == true){
                                                draw_mmd(is_init);
                                            }
                                        }
                                    }
                                }
                            }
                        });
                    }
                }
            });
        });
        fs.root.getDirectory('actions', {create: true}, function(dirEntry){                       // load action
            var dirReader = dirEntry.createReader();
            dirReader.readEntries (function(results) {
                var total_action = 2*results.length;
                var load_count = 0;
                var k = 0;
                var l = 0;
                for (var i in results){
                    if(results[i]["isDirectory"]){
                        var actionReader = results[i].createReader();
                        actionReader.readEntries (function(action_results) {
                            var motions = {};
                            motionParams[1].motions.push({});
                            for (var j in action_results){
                                if(action_results[j]["isFile"]){
                                    var file_name = action_results[j].name;
                                    var file_type = file_name.split(".").slice(-1)[0];
                                    if(file_type == 'json' ){
                                        $.getJSON( action_results[j].toURL(), function( json ) {
                                            motionParams[1].motions[k]["action"] = json["action"];
                                            motionParams[1].motions[k]["title"] = json["name"];
                                            command2idx[json["name"]] = k;
                                            k += 1;
                                            load_count += 1;
                                            if (load_count == total_action){
                                                info_load_action_flag = true;
                                                if (info_load_model_flag == true && info_load_music_flag == true && info_load_action_flag == true){
                                                    draw_mmd(is_init);
                                                }
                                            }
                                        });
                                    }
                                    if(file_type == 'vmd' ){
                                        motionParams[1].motions[l]["vmd"] = action_results[j].toURL();
                                        motionParams[1].motions[l]["name"] = file_name;
                                        motionParams[1].motions[l]["dir"] = action_results[j].toURL().split("/").slice(-2)[0];
                                        if (motionParams[1].motions[l]["dir"] == "_default_front_walking"){
                                            action_root = l;
                                        }
                                        l += 1;
                                        load_count += 1;
                                        if (load_count == total_action){
                                            info_load_action_flag = true;
                                            if (info_load_model_flag == true && info_load_music_flag == true && info_load_action_flag == true){
                                                draw_mmd(is_init);
                                            }
                                        }
                                    }
                                }
                            }
                        });
                    }
                }
            });
        });
    },err);
}

// MMDのモデル情報だけ更新する  // アホくさ
function update_model_info(){
    modelParams = [];
    webkitRequestFileSystem(window.TEMPORARY, 5*1024*1024*1024, function(_fs) {
        fs = _fs;
        fs.root.getDirectory('model', {create: true}, function(dirEntry){                       // load model
            var dirReader = dirEntry.createReader();
            dirReader.readEntries (function(results) {
                var total_model = results.length;
                var load_model_count = 0;
                for (var i in results){
                    if(results[i]["isDirectory"]){
                        var modelReader = results[i].createReader();
                        modelReader.readEntries (function(model_results) {
                            for (var j in model_results){
                                if(model_results[j]["isFile"]){
                                    var file_name = model_results[j].name;
                                    var file_type = file_name.split(".").slice(-1)[0];
                                    if(file_type == 'pmd' || file_type == 'pmx'){
                                        var model_dir = model_results[j].toURL().split("/").slice(-2)[0]
                                            modelParams.push({name:file_name, 
                                                file:model_results[j].toURL(), 
                                                dir:model_dir});
                                        load_model_count += 1;
                                        if (load_model_count >= total_model){
                                            $("#model_input_panel").fadeOut();
                                            $("#now_load_pmd").css("display", "none");
                                            $("#model_pmd_input").css("display", "block");
                                            draw_model_list();
                                        }
                                    }
                                }
                            }
                        });
                    }
                }
            });
        });
    },err);
}


////////////////////////////////////////////////////////////////
//                  GUI操作
////////////////////////////////////////////////////////////////
$(document).on("click", "#menu_button", function(){
    $(this).css("display", "none");
    $("#menu_window").fadeIn();
    if ($("#youtube_frame>iframe")[0]){
        yt_player.pauseVideo();
    }
});
$(document).on("click", "#close_menu", function(){
    $("#menu_window").css("display", "none");
    $("#menu_button").css("display", "block");
    $("#mode_button").css("display", "flex");
    $("#youtube_panel").css("display", "none");
    $("#music_motion_input_panel").css("display", "none");
    $("#model_input_panel").css("display", "none");
    $("#control_input_panel").css("display", "none");
    close_music_option();
    close_model_option();
    close_control_option();
});
$(document).on("click", "#mode_button", function(){
    var mode = $(this).attr("mode");
    if (mode == "music"){
        if ($("#youtube_frame>iframe")[0]){
            yt_player.pauseVideo();
            pause_motion();
        }
        $("#mode_button").css("background", "orange").attr("mode", "command");
        $("#mode_button>div").text("コマンドモード");
        $("#youtube_control").css("display", "none");
        $("#mic").css("display", "block");
        $("#youtube_frame").children().remove();
    }else{
        $("#mode_button").css("background", "cyan").attr("mode", "music");
        $("#mode_button>div").text("ミュージックモード");
        $("#mic").css("display", "none");
        $(".arrow_box").css("display", "none");
        var motions = motionParams[0].motions;          // 選択したidのモーションに設定する
        var motionIndex = 0;
        var video_id = motions[motionIndex].video_id;
        mmdStatus.changeModeName = "music";
        mmdStatus.changeMotioinName = motions[motionIndex].name;
        mmdStatus.changeMotionIndex = motionIndex;
        mmdStatus.changeMotion = true;
        $("<div/>").attr("id", "yt_player").appendTo($("#youtube_frame"));
        yt_player = new YT.Player('yt_player', {
            height: '90',
            width: '160',
            videoId: video_id,
            playerVars: {
                autoplay: 0, // 自動再生する・しない
                controls: 1, // コントロールを表示する・しない
                showinfo: 0, // 動画の情報テキストを表示する・しない
                theme: "dark" // テーマの選択（dark|light）
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange
            }
        });
    }
});
$(document).on("click", "#music_tab", function(){
    $(".tab.select").removeClass("select");
    $(this).addClass("select");
    $(".panel").css("display", "none");
    $("#music_panel").css("display", "block");
    $("#model_input_panel").css("display", "none");
    $("#control_input_panel").css("display", "none");
    close_model_option();
    close_control_option();
});
$(document).on("click", "#control_tab", function(){
    $(".tab.select").removeClass("select");
    $(this).addClass("select");
    $(".panel").css("display", "none");
    $("#control_panel").css("display", "block");
    $("#youtube_panel").css("display", "none");
    $("#music_motion_input_panel").css("display", "none");
    $("#model_input_panel").css("display", "none");
    close_music_option();
    close_model_option();
});
$(document).on("click", "#model_tab", function(){
    $(".tab.select").removeClass("select");
    $(this).addClass("select");
    $(".panel").css("display", "none");
    $("#model_panel").css("display", "block");
    $("#youtube_panel").css("display", "none");
    $("#music_motion_input_panel").css("display", "none");
    $("#control_input_panel").css("display", "none");
    close_music_option();
    close_control_option();
});
function close_music_option(){
    $(".music_option_button.open").parent().css("left", "calc(100% - 30px)");
    $(".music_option_button.open").removeClass("open")
        .addClass("close")
        .text("◀");
}
$(document).on("click", ".music_option_button.close", function(){
    close_music_option();
    $(this).parent().css("left", "calc(100% - 120px)");
    $(this).removeClass("close")
        .addClass("open")
        .text("▶");
});
$(document).on("click", ".music_option_button.open", function(){
    $(this).parent().css("left", "calc(100% - 30px)");
    $(this).removeClass("open")
        .addClass("close")
        .text("◀");
});
$(document).on("click", "#add_music", function(){
    close_music_option();
    $("#youtube_panel").fadeIn();
});
$(document).on("click", "#close_youtube", function(){
    $("#youtube_panel").fadeOut();
});
function close_model_option(){
    $(".model_option_button.open").parent().css("left", "calc(100% - 30px)");
    $(".model_option_button.open").removeClass("open")
        .addClass("close")
        .text("◀");
}
$(document).on("click", ".model_option_button.close", function(){
    close_model_option();
    $(this).parent().css("left", "calc(100% - 120px)");
    $(this).removeClass("close")
        .addClass("open")
        .text("▶");
});
$(document).on("click", ".model_option_button.open", function(){
    $(this).parent().css("left", "calc(100% - 30px)");
    $(this).removeClass("open")
        .addClass("close")
        .text("◀");
});
function close_control_option(){
    $(".control_option_button.open").parent().css("left", "calc(100% - 30px)");
    $(".control_option_button.open").removeClass("open")
        .addClass("close")
        .text("◀");
}
$(document).on("click", ".control_option_button.close", function(){
    close_control_option();
    $(this).parent().css("left", "calc(100% - 120px)");
    $(this).removeClass("close")
        .addClass("open")
        .text("▶");
});
$(document).on("click", ".control_option_button.open", function(){
    $(this).parent().css("left", "calc(100% - 30px)");
    $(this).removeClass("open")
        .addClass("close")
        .text("◀");
});


////////////////////////////////////////////////////////////////
//                  便利関数
////////////////////////////////////////////////////////////////
// 数字をカンマ区切りにする
function separate(num){
    num = String(num);
    var len = num.length;
    if(len > 3){
        return separate(num.substring(0,len-3))+','+num.substring(len-3);
    } else {
        return num;
    }
}

// 日付フォーマット
var formatDate = function (date, format) {
    if (!format) format = 'YYYY-MM-DD hh:mm:ss.SSS';
    format = format.replace(/YYYY/g, date.getFullYear());
    format = format.replace(/MM/g, ('0' + (date.getMonth() + 1)).slice(-2));
    format = format.replace(/DD/g, ('0' + date.getDate()).slice(-2));
    format = format.replace(/hh/g, ('0' + date.getHours()).slice(-2));
    format = format.replace(/mm/g, ('0' + date.getMinutes()).slice(-2));
    format = format.replace(/ss/g, ('0' + date.getSeconds()).slice(-2));
    if (format.match(/S/g)) {
        var milliSeconds = ('00' + date.getMilliseconds()).slice(-3);
        var length = format.match(/S/g).length;
        for (var i = 0; i < length; i++) format = format.replace(/S/, milliSeconds.substring(i, i + 1));
    }
    return format;
};

// 濁点半濁点を結合
function concatDakuten(str){
    var table1 = ['が','ぎ','ぐ','げ','ご','ざ','じ','ず','ぜ','ぞ','だ','ぢ','づ','で','ど','ば','び','ぶ','べ','ぼ','ヴ','ガ','ギ','グ','ゲ','ゴ','ザ','ジ','ズ','ゼ','ゾ','ダ','ヂ','ヅ','デ','ド','バ','ビ','ブ','ベ','ボ','ぱ','ぴ','ぷ','ぺ','ぽ','パ','ピ','プ','ペ','ポ'];    
    var table2 = ['が','ぎ','ぐ','げ','ご','ざ','じ','ず','ぜ','ぞ','だ','ぢ','づ','で','ど','ば','び','ぶ','べ','ぼ','ヴ','ガ','ギ','グ','ゲ','ゴ','ザ','ジ','ズ','ゼ','ゾ','ダ','ヂ','ヅ','デ','ド','バ','ビ','ブ','ベ','ボ','は','ひ','ぷ','ぺ','ぽ','パ','ピ','プ','ペ','ポ'];
    var i = 0, ii = table1.length;
    for(; i < ii; i++){
        str = str.replace(new RegExp(table1[i], 'g'), table2[i]);
    }
    return str;
}
// OS情報の取得
function getOS() {
    var userAgent = window.navigator.userAgent,
    platform = window.navigator.platform,
    macosPlatforms = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'],
    windowsPlatforms = ['Win32', 'Win64', 'Windows', 'WinCE'],
    iosPlatforms = ['iPhone', 'iPad', 'iPod'],
    os = null;
    if (macosPlatforms.indexOf(platform) !== -1) {
        os = 'Mac OS';
    } else if (iosPlatforms.indexOf(platform) !== -1) {
        os = 'iOS';
    } else if (windowsPlatforms.indexOf(platform) !== -1) {
        os = 'Windows';
    } else if (/Android/.test(userAgent)) {
        os = 'Android';
    } else if (!os && /Linux/.test(platform)) {
        os = 'Linux';
    }
    return os;
}
// ラジアンを-PI~PIに正規化
function radianNormalize(radian){
    return Math.atan2(Math.sin(radian), Math.cos(radian));
}


////////////////////////////////////////////////////////////////
//                  実行
////////////////////////////////////////////////////////////////
if (getOS() == "iOS"){
    alert("本アプリは現在iOSでは動作いたしません。次期OSのiOS11にて動作可能になる予定です。Android端末またはPCにて動作いたします。")
} else{
    var init_flag = localStorage.getItem("init_load");
    var remove_monitor, init_monitor;
    // 本当に最初のロード
    if (init_flag != "true"){
        // 初期ロードが完全にできていない時はまずシステムを全消去する
        remove_file_system();        
        remove_monitor = requestAnimationFrame(function animate(){
            if (remove_flag == true){
                cancelAnimationFrame(remove_monitor);
                init_file_system();
            }else{
                remove_monitor = requestAnimationFrame( animate );
            }
        });
        // 初期ロードする
        init_monitor = requestAnimationFrame(function animate(){
            if(init_load_model_flag==true && init_load_music_flag==true && init_load_motion_flag==true && init_load_action_info_flag == true && init_load_action_flag == true){
                cancelAnimationFrame(init_monitor);
                console.log("loaded default files");
                $("#load_console").text("load default files");
                localStorage.setItem("init_load", "true");
                load_mmd_files(true);
            }else{
                init_monitor = requestAnimationFrame( animate );
            }
        });
    }else{
        load_mmd_files(true);
    }
    // FPSの表示
    var stats = new Stats();
    stats.dom.style.zIndex = 0;
    document.getElementById('stats').appendChild(stats.dom);
};


