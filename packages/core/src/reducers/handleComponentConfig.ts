import { StateType } from '../types';
import { copyConfig, deleteChildNodes, getLocation} from '../utils';
import get from 'lodash/get';
import update from 'lodash/update';
import { produce } from 'immer';
import uuid from 'uuid';
import { LayoutSortPayload } from '../actions';
import { LEGO_BRIDGE } from '../store';

/**
 * 往画板或者容器组件添加组件
 * @param state
 * @returns {{componentConfigs: *}}
 */
export function addComponent(state: StateType) {
    const {
        undo, redo,
        componentConfigs,
        selectedInfo,
        dragSource,
        dropTarget,
    } = state;
    /**
     * 如果没有拖拽的组件不做添加动作, 如果没有
     */
    const {selectedKey,  propName,domTreeKeys} = selectedInfo||dropTarget||{};
    if (!dragSource) return state
    if(componentConfigs.root&&!selectedKey) return {...state,...(undo.pop()),dragSource:null} as StateType
    const { vDOMCollection,dragKey, parentKey,parentPropName} = dragSource;

    /**
     * 当拖拽的父key与drop目标key一致说明未移动
     * 当拖拽的key包含在drop目标的domTreeKeys,说明拖拽组件是目标组件的父组件或者是自身
     */
    if(parentKey&&parentKey===selectedKey||domTreeKeys&&domTreeKeys.includes(dragKey!)) return state

    if(!componentConfigs.root) {
        undo.push({componentConfigs});
        redo.length = 0;
        return {
            ...state,
            componentConfigs:vDOMCollection,
            dragSource:null,
            undo,
            redo
        } as StateType
    }

    /**
     * 获取当前拖拽组件的父组件约束，以及属性节点配置信息
     */
    const dragComponentName=get(componentConfigs[dragKey],'componentName')
    const dropComponentName=get(componentConfigs[selectedKey!],'componentName')
    const {fatherNodesRule} = get(LEGO_BRIDGE.config!.AllComponentConfigs,dragComponentName );
    const {nodePropsConfig}=get(LEGO_BRIDGE.config!.AllComponentConfigs,dropComponentName)

    /**
     * 父组件约束限制，减少不必要的组件错误嵌套
     */
    if (fatherNodesRule && !fatherNodesRule.includes(propName ? `${dropComponentName}.${propName}` : `${dropComponentName}`)) {
        // todo
       throw new Error(`${dragComponentName}:只允许放入${fatherNodesRule.toString()}组件或者属性中`);
    }
    /**
     * 子组件约束限制，减少不必要的组件错误嵌套
     */
    if(nodePropsConfig&&propName){
        const childNodesRule=nodePropsConfig[propName].childNodesRule
        if (childNodesRule && !childNodesRule.includes(dragComponentName)) {
            // todo
            throw new Error(`${propName || dropComponentName}:只允许拖拽${childNodesRule.toString()}组件`);
        }
    }
    undo.push({componentConfigs});
    redo.length = 0;
    return {
        ...state,
        componentConfigs:produce(componentConfigs,oldConfigs=>{
            const newKey=dragKey||uuid()
            //添加新组件到指定容器中
            update(oldConfigs,getLocation(selectedKey!,propName),childNodes=>{
                return [...childNodes,newKey]
            })
            //如果有父key说明是跨组件的拖拽，原先的父容器需要删除该组件的引用
            if(parentKey){
                update(oldConfigs,getLocation(parentKey,parentPropName),childNodes=>childNodes.filter((nodeKey:string)=>nodeKey!==dragKey))
            }
        }),
        dragSource: null,
        dropTarget: null,
        undo,
        redo,
    } as StateType;
}

/**
 * 复制组件
 * @param state
 * @returns {{componentConfigs: *}}
 */
export function copyComponent(state: StateType) {
    const {undo, redo, componentConfigs, selectedInfo} = state;
    /**
     * 未选中组件不做任何操作
     */
    if (!selectedInfo||selectedInfo.selectedKey==='root') {
        return state
    }
    const {selectedKey,parentPropName,parentKey} = selectedInfo;
    undo.push({componentConfigs});
    redo.length = 0;
    return {
        ...state,
        componentConfigs:produce(componentConfigs,oldConfigs=>{
            const newKey=uuid()
            update(oldConfigs,getLocation(parentKey,parentPropName),childNodes=>[...childNodes,newKey])
            copyConfig(oldConfigs, selectedKey,newKey);
        }),
        undo,
        redo,
    };
}

/**
 * 当domTree中拖拽节点调整顺序时触发
 * @param state
 * @param payload
 * @returns {{componentConfigs: *}}
 */
export function onLayoutSortChange(state: StateType, payload: LayoutSortPayload) {
    const {sortKeys,parentKey,parentPropName,dragInfo} = payload;
    const {undo, redo, componentConfigs} = state;
    undo.push({componentConfigs});
    redo.length = 0;
    return {
        ...state,
        componentConfigs:produce(componentConfigs,oldConfigs=>{
            update(oldConfigs, getLocation(parentKey,parentPropName), () => sortKeys);
            if(dragInfo){
                const {key,parentKey,parentPropName}=dragInfo
                update(oldConfigs,getLocation(parentKey,parentPropName),(childNodes)=>{
                    return  childNodes.filter((nodeKey:string)=>nodeKey!==key)
                })
            }
        }),
        undo,
        redo,
    } as StateType;
}

/**
 * 删除组件
 * @param state
 * @returns {{propsSetting: *, componentConfigs: *, selectedInfo: *}}
 */
export function deleteComponent(state: StateType) {
    const {undo, redo, componentConfigs, selectedInfo, propsSetting} = state;
    /**
     * 未选中组件将不做任何操作
     */
    if (!selectedInfo) {
        return state
    }
    const {selectedKey, parentKey,parentPropName} = selectedInfo;
    undo.push({componentConfigs, propsSetting, selectedInfo});
    redo.length = 0;
    return {
        ...state,
        componentConfigs:produce(componentConfigs,oldConfig=>{
            if(selectedKey==='root'){
                return {}
            }else {
                update(oldConfig,getLocation(parentKey,parentPropName),childNodes=>childNodes.filter((childKey:string)=>childKey!==selectedKey))
                if(oldConfig[selectedKey].childNodes){
                    deleteChildNodes(oldConfig,oldConfig[selectedKey].childNodes!)
                }
                delete oldConfig[selectedKey]
            }
        }),
        propsSetting: null,
        selectedInfo: null,
        undo,
        redo,
    };
}

/**
 * 清除所有子节点
 * @param state
 * @returns {{undo: *, componentConfigs, redo: *}}
 */

export function clearChildNodes(state: StateType) {
    const {componentConfigs, selectedInfo, undo, redo} = state;
    if (!selectedInfo) {
        //todo
        return state
    }
    const {selectedKey,propName} = selectedInfo;
    undo.push({componentConfigs});
    redo.length = 0;
    return {
        ...state,
        componentConfigs:produce(componentConfigs,oldConfig=>{
                deleteChildNodes(oldConfig,oldConfig[selectedKey].childNodes!)
            update(oldConfig, getLocation(selectedKey,propName), () => []);
        }),
        undo,
        redo,
    };
}
