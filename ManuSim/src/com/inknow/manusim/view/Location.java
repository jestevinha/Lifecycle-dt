package com.inknow.manusim.view;

import com.inknow.manusim.control.Const;

/** Location is the object representing a location in the plant building. 
 * It is used to support the movement of the actors. 
*
* @author Rui Neves-Silva (UNINOVA - FCT/UNL)
* @version 1.0 Build 0001 Nov-2011/Feb-2013.
*/

public class Location {
	
	private int id;
	private WorkareaPane workareaPane;
	private int xWorkarea;
	private int yWorkarea;

	// constructors

	public Location() {
		this.id = -1;
		this.workareaPane = null;
		this.xWorkarea = 0;
		this.yWorkarea = 0;
	}
	
	public Location(int id) {
		this.id = id;
		this.workareaPane = null;
		this.xWorkarea = Const.ACTOR_LOCATION_WORKAREA_X;
		this.yWorkarea = Const.ACTOR_LOCATION_WORKAREA_Y;
	}

	// gets & sets
	
	public int getId() {
		return this.id;
	}

	public WorkareaPane getWorkareaPane() {
		return this.workareaPane;
	}

	public int getxWorkarea() {
		return this.xWorkarea;
	}

	public int getyWorkarea() {
		return this.yWorkarea;
	}

	//--
	
	public void setId(int id) {
		this.id = id;
		return;
	}

	public void setWorkareaPane(WorkareaPane workareaPane) {
		this.workareaPane = workareaPane;
		return;
	}

	public void setxWorkarea(int xWorkarea) {
		this.xWorkarea = xWorkarea;
		return;
	}

	public void setyWorkarea(int yWorkarea) {
		this.yWorkarea = yWorkarea;
		return;
	}

} // EOF
