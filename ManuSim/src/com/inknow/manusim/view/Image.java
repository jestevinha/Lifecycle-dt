package com.inknow.manusim.view;

import javax.swing.ImageIcon;

/** Image is the object referencing a specific image file used by all objects that have a graphical representation in the simulator. 
*
* @author Rui Neves-Silva (UNINOVA - FCT/UNL)
* @version 1.0 Build 0001 Nov-2011.
*/

public class Image {
	
	private String fileName;
	private int width;
	private int height;
	
	// constructors
	
	public Image() {
		this.fileName = "";
		this.width = 0;
		this.height = 0;
	}
	
	public Image(String fileName) {
		this.fileName = fileName;
		ImageIcon auxImage = new ImageIcon(fileName);
		this.width = auxImage.getIconWidth();
		this.height = auxImage.getIconHeight();
	}
	
	public Image(String fileName, int width, int height) {
		this.fileName = fileName;
		this.width = width;
		this.height = height;
	}

	// sets & gets
	
	public String getFileName() {
		return fileName;
	}

	public int getWidth() {
		return width;
	}

	public int getHeight() {
		return height;
	}

	//--
	
	public void setFileName(String fileName) {
		this.fileName = fileName;
		return;
	}

	public void setWidth(int width) {
		this.width = width;
		return;
	}

	public void setHeight(int height) {
		this.height = height;
		return;
	}
	
} // EOF
