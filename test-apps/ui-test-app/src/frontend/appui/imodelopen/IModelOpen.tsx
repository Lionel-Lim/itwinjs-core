/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import "./IModelOpen.scss";
import "./Common.scss";
import classnames from "classnames";
import * as React from "react";
import { AccessToken, BeDuration } from "@itwin/core-bentley";
import { ITwin, ITwinAccessClient } from "@bentley/context-registry-client";
import { HubIModel, IModelHubFrontend, IModelQuery, Version, VersionQuery } from "@bentley/imodelhub-client";
import { ActivityMessageDetails, ActivityMessageEndReason, IModelApp } from "@itwin/core-frontend";
import { ActivityMessagePopup } from "@itwin/appui-react";
import { Button } from "@itwin/itwinui-react";
import { AppTools } from "../../tools/ToolSpecifications";
import { IModelInfo } from "../ExternalIModel";
import { BlockingPrompt } from "./BlockingPrompt";
import { IModelList } from "./IModelList";
import { NavigationItem, NavigationList } from "./Navigation";
import { ProjectDropdown } from "./ProjectDropdown";

/** Properties for the [[IModelOpen]] component */
export interface IModelOpenProps {
  getAccessToken: () => Promise<AccessToken>;
  onIModelSelected?: (iModelInfo: { iTwinId: string, id: string, name: string }) => void;
  initialIModels?: IModelInfo[];
}

interface IModelOpenState {
  isLoadingProjects: boolean;
  isLoadingiModels: boolean;
  isLoadingiModel: boolean;
  recentITwins?: ITwin[];
  iModels?: IModelInfo[];
  currentITwin?: ITwin;
  prompt: string;
  isNavigationExpanded: boolean;
}

/**
 * Open component showing projects and iModels
 */
export class IModelOpen extends React.Component<IModelOpenProps, IModelOpenState> {

  constructor(props?: any, context?: any) {
    super(props, context);

    this.state = {
      isLoadingProjects: true,
      isLoadingiModels: false,
      isLoadingiModel: false,
      isNavigationExpanded: false,
      prompt: "Fetching project information...",
    };
  }

  public override async componentDidMount(): Promise<void> {
    if (this.props.initialIModels && this.props.initialIModels.length > 0) {
      this.setState({
        isLoadingProjects: false,
        isLoadingiModels: false,
        isLoadingiModel: false,
        currentITwin: {
          id: this.props.initialIModels[0].iTwinId, // eslint-disable-line @itwin/react-set-state-usage
        },
        iModels: this.props.initialIModels,  // eslint-disable-line @itwin/react-set-state-usage
      });
    }

    const token = await this.props.getAccessToken();
    if ("" === token)
      return;

    const accessToken = await IModelApp.getAccessToken();
    const client = new ITwinAccessClient();
    const iTwins = await client.getAll(accessToken, { pagination: { skip: 0, top: 10 } });
    this.setState({
      isLoadingProjects: false,
      isLoadingiModels: true,
      recentITwins: iTwins,
    });
    if (iTwins.length > 0)
      this._selectITwin(iTwins[0]);  // eslint-disable-line @typescript-eslint/no-floating-promises
  }

  public async getIModels(iTwinId: string, top: number, skip: number): Promise<IModelInfo[]> {

    const accessToken = await IModelApp.getAccessToken();
    const hubAccess = new IModelHubFrontend();

    const iModelInfos: IModelInfo[] = [];
    const queryOptions = new IModelQuery();
    queryOptions.select("*").top(top).skip(skip);
    try {
      const iModels: HubIModel[] = await hubAccess.hubClient.iModels.get(accessToken, iTwinId, queryOptions);
      for (const imodel of iModels) {
        const versions: Version[] = await hubAccess.hubClient.versions.get(accessToken, imodel.id!, new VersionQuery().select("Name,ChangeSetId").top(1));
        if (versions.length > 0) {
          imodel.latestVersionName = versions[0].name;
          imodel.latestVersionChangeSetId = versions[0].changeSetId;
        }
      }
      for (const thisIModel of iModels) {
        iModelInfos.push({
          iTwinId,
          id: thisIModel.id!,
          name: thisIModel.name!,
          createdDate: new Date(thisIModel.createdDate!),
        });
      }
    } catch (e) {
      alert(JSON.stringify(e));
      throw e;
    }
    return iModelInfos;
  }

  // retrieves the IModels for a Project. Called when first mounted and when a new Project is selected.
  private startRetrieveIModels = async (iTwin: ITwin) => {
    this.setState({
      prompt: "Fetching iModel information...",
      isLoadingiModels: true,
      isLoadingProjects: false,
      currentITwin: iTwin,
    });
    const iModelInfos = await this.getIModels(iTwin.id, 80, 0);
    this.setState({
      isLoadingiModels: false,
      iModels: iModelInfos,
    });
  };

  private _onNavigationChanged = (expanded: boolean) => {
    this.setState({ isNavigationExpanded: expanded });
  };

  private _selectITwin = async (iTwin: ITwin) => {
    return this.startRetrieveIModels(iTwin);
  };

  private _handleIModelSelected = (iModelInfo: IModelInfo): void => {
    this.setState({
      prompt: `Opening '${iModelInfo.name}'...`,
      isLoadingiModel: true,
    }, () => {
      if (this.props.onIModelSelected)
        this.props.onIModelSelected(iModelInfo);
    });
  };

  private renderIModels() {
    if (this.state.isLoadingProjects || this.state.isLoadingiModels) {
      return (
        <BlockingPrompt prompt={this.state.prompt} />
      );
    } else {
      return (
        <>
          <IModelList iModels={this.state.iModels}
            onIModelSelected={this._handleIModelSelected} />
          {this.state.isLoadingiModel &&
            <BlockingPrompt prompt={this.state.prompt} />
          }
        </>
      );
    }
  }

  /** Tool that will start a sample activity and display ActivityMessage. */
  private _activityTool = async () => {
    let isCancelled = false;
    let progress = 0;

    const details = new ActivityMessageDetails(true, true, true, true);
    details.onActivityCancelled = () => {
      isCancelled = true;
    };
    IModelApp.notifications.setupActivityMessage(details);

    while (!isCancelled && progress <= 100) {
      IModelApp.notifications.outputActivityMessage("This is a sample activity message", progress);
      await BeDuration.wait(100);
      progress++;
    }

    const endReason = isCancelled ? ActivityMessageEndReason.Cancelled : ActivityMessageEndReason.Completed;
    IModelApp.notifications.endActivityMessage(endReason);
  };

  public override render() {
    const contentStyle = classnames("open-content", this.state.isNavigationExpanded && "pinned");
    return (
      <>
        <div>
          <div className="open-appbar">
            <div className="backstage-icon">
              <span className="icon icon-home" onPointerUp={() => AppTools.backstageToggleCommand.execute()} />
            </div>
            <div className="project-picker-content">
              <span className="projects-label">Projects</span>
              <div className="project-picker">
                <ProjectDropdown currentProject={this.state.currentITwin} recentProjects={this.state.recentITwins} onProjectClicked={this._selectITwin.bind(this)} />
              </div>
            </div>
            <Button styleType="cta" style={{ display: "none" }} className="activity-button" onClick={this._activityTool}>Activity Message</Button>
          </div>
          <NavigationList defaultTab={0} onExpandChanged={this._onNavigationChanged}>
            <NavigationItem label="Recent" icon="icon-placeholder" />
            <NavigationItem label="Offline" icon="icon-placeholder" />
            <NavigationItem label="Browse History" icon="icon-placeholder" />
            <NavigationItem label="iModels" icon="icon-placeholder" />
            <NavigationItem label="Share" icon="icon-placeholder" />
            <NavigationItem label="Share Point" icon="icon-placeholder" />
            <NavigationItem label="Reality Data" icon="icon-placeholder" />
            <NavigationItem label="New Project..." icon="icon-placeholder" />
          </NavigationList>
          <div className={contentStyle}>
            {this.renderIModels()}
          </div>
        </div>
        <ActivityMessagePopup />
      </>
    );
  }
}
